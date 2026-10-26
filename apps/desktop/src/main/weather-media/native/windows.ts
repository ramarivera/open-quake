import { Effect, Schema } from "effect";
import { MediaSession } from "../../../shared/weather-media-contracts";
import type { NativeMediaAction } from "../system-media";
import {
	MediaHelperUnavailable,
	MediaProcessFailed,
	MediaResponseInvalid,
} from "./errors";
import type { CoverDecoder, NativeMediaReading } from "./metadata";
import { type MediaProcess, mediaProcess } from "./process";

/** Shared by display reads and relative seeks, including sparse native timeline updates. */
export const windowsPositionScript = `
function CurrentPositionTicks($timeline, $info) {
 $position=[double]$timeline.Position.Ticks
 if ([string]$info.PlaybackStatus -eq 'Playing') {
  $rate=1.0
  if ($null -ne $info.PlaybackRate) { $rate=[double]$info.PlaybackRate }
  $position+=[Math]::Max(0,([DateTimeOffset]::UtcNow-$timeline.LastUpdatedTime).TotalMilliseconds)*10000*$rate
 }
 return [long][Math]::Max($timeline.StartTime.Ticks,[Math]::Min($timeline.EndTime.Ticks,$position))
}
`;

/** Fixed program. Request data is JSON in the environment, never PowerShell source. */
export const windowsMediaScript = `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
${windowsPositionScript}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$taskMethod=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation' + [char]96 + '1')} | Select-Object -First 1
function Await($operation, [Type]$resultType) {
 $task=$taskMethod.MakeGenericMethod($resultType).Invoke($null,@($operation))
 if (-not $task.Wait(2000)) { throw [TimeoutException]::new('Media operation timed out') }
 return $task.GetAwaiter().GetResult()
}
try { $manager=Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) }
catch {
 $cause=$_.Exception
 while ($null -ne $cause.InnerException) { $cause=$cause.InnerException }
 if ($cause.HResult -eq -2147024891) { '{"error":"TCC_DENIED"}'; exit 0 }
 if ($cause.HResult -eq -2147023836) { '{"error":"SMTC_UNAVAILABLE"}'; exit 0 }
 throw
}
$session=$manager.GetCurrentSession()
if ($null -eq $session) { '{"session":null,"commands":[],"source":""}'; exit 0 }
$source=[string]$session.SourceAppUserModelId
$info=$session.GetPlaybackInfo()
$controls=$info.Controls
$commands=@()
if ($controls.IsPlayEnabled) { $commands+=0 }
if ($controls.IsPauseEnabled) { $commands+=1 }
if ($controls.IsStopEnabled) { $commands+=3 }
if ($controls.IsNextEnabled) { $commands+=4 }
if ($controls.IsPreviousEnabled) { $commands+=5 }
if ($controls.IsShuffleEnabled) { $commands+=6 }
if ($controls.IsRepeatEnabled) { $commands+=7 }
if ($controls.IsPlaybackPositionEnabled) { $commands+=12; $commands+=13 }
if ($env:OPEN_QUAKE_MEDIA_REQUEST) {
 $request=$env:OPEN_QUAKE_MEDIA_REQUEST | ConvertFrom-Json
 if ($source -cne $request.source) { '{"accepted":false}'; exit 0 }
 $ids=@{play=0;pause=1;stop=3;next=4;previous=5;shuffle=6;repeat=7;rewind=12;forward=13}
 if (-not $ids.ContainsKey([string]$request.action) -or $commands -notcontains $ids[[string]$request.action]) { '{"accepted":false}'; exit 0 }
 switch ([string]$request.action) {
  'play' {$op=$session.TryPlayAsync()}
  'pause' {$op=$session.TryPauseAsync()}
  'stop' {$op=$session.TryStopAsync()}
  'next' {$op=$session.TrySkipNextAsync()}
  'previous' {$op=$session.TrySkipPreviousAsync()}
  'shuffle' {
   if ($null -eq $info.IsShuffleActive) { '{"accepted":false}'; exit 0 }
   $op=$session.TryChangeShuffleActiveAsync(-not [bool]$info.IsShuffleActive)
  }
  'repeat' {
   if ($null -eq $info.AutoRepeatMode) { '{"accepted":false}'; exit 0 }
   $mode=([int]$info.AutoRepeatMode + 1) % 3
   $null=[Windows.Media.Playback.MediaPlaybackAutoRepeatMode,Windows.Media,ContentType=WindowsRuntime]
   $op=$session.TryChangeAutoRepeatModeAsync([Windows.Media.Playback.MediaPlaybackAutoRepeatMode]$mode)
  }
  {$_ -in @('rewind','forward')} {
   $timeline=$session.GetTimelineProperties()
   $delta=150000000
   if ($request.action -eq 'rewind') { $delta=-$delta }
   $ticks=[Math]::Max($timeline.StartTime.Ticks,[Math]::Min($timeline.EndTime.Ticks,(CurrentPositionTicks $timeline $info)+$delta))
   $op=$session.TryChangePlaybackPositionAsync([long]$ticks)
  }
 }
 $accepted=Await $op ([bool])
 @{accepted=[bool]$accepted} | ConvertTo-Json -Compress
 exit 0
}
$properties=Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
$artwork=$null
$artworkMime=$null
if ($null -ne $properties.Thumbnail) {
 $null=[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
 $stream=Await ($properties.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
 try {
  if ($stream.Size -gt 0 -and $stream.Size -le 2097152 -and $stream.ContentType -in @('image/png','image/jpeg','image/webp')) {
   $null=[Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
   $reader=[Windows.Storage.Streams.DataReader]::new($stream)
   try {
    $loaded=Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32])
    if ($loaded -eq $stream.Size) {
     $bytes=[byte[]]::new($loaded)
     $reader.ReadBytes($bytes)
     $artwork=[Convert]::ToBase64String($bytes)
     $artworkMime=[string]$stream.ContentType
    }
   } finally { $reader.Dispose() }
  }
 } finally { $stream.Dispose() }
}
$timeline=$session.GetTimelineProperties()
$playing=([string]$info.PlaybackStatus -eq 'Playing')
$position=(CurrentPositionTicks $timeline $info)/10000
$duration=[Math]::Max(0,$timeline.EndTime.TotalMilliseconds)
$position=[Math]::Max(0,[Math]::Min($duration,$position))
@{session=@{id=$source;appId=$source;appName=$source.Substring(0,[Math]::Min(200,$source.Length));title=[string]$properties.Title;artist=[string]$properties.Artist;coverUrl=$null;playing=$playing;durationMs=$duration;positionMs=$position;canPlay=[bool]$controls.IsPlayEnabled;canPause=[bool]$controls.IsPauseEnabled;canPrevious=[bool]$controls.IsPreviousEnabled;canNext=[bool]$controls.IsNextEnabled};commands=@($commands);source=$source;artwork=$artwork;artworkMime=$artworkMime} | ConvertTo-Json -Compress -Depth 5
`;
const Reading = Schema.Struct({
	session: Schema.NullOr(MediaSession),
	commands: Schema.Array(Schema.Int).pipe(Schema.maxItems(256)),
	source: Schema.String.pipe(Schema.maxLength(300)),
	artwork: Schema.optional(
		Schema.NullOr(Schema.String.pipe(Schema.maxLength(2_800_000))),
	),
	artworkMime: Schema.optional(
		Schema.NullOr(Schema.String.pipe(Schema.maxLength(100))),
	),
});
export const makeWindowsMedia = (
	run: MediaProcess = mediaProcess,
	cover: CoverDecoder = () => null,
) => {
	const call = (request?: { source: string; action: NativeMediaAction }) =>
		run(
			"powershell.exe",
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				Buffer.from(windowsMediaScript, "utf16le").toString("base64"),
			],
			request ? { OPEN_QUAKE_MEDIA_REQUEST: JSON.stringify(request) } : {},
		);
	const decode = (text: string) =>
		Effect.try({
			try: () => {
				const raw: unknown = JSON.parse(text);
				if (
					Schema.is(Schema.Struct({ error: Schema.Literal("TCC_DENIED") }))(raw)
				)
					throw MediaProcessFailed.fromCause(
						Object.assign(new Error("Media access denied"), { code: "EACCES" }),
					);
				if (
					Schema.is(
						Schema.Struct({ error: Schema.Literal("SMTC_UNAVAILABLE") }),
					)(raw)
				)
					throw MediaHelperUnavailable.fromCause(
						Object.assign(new Error("Media service is unavailable"), {
							code: "ENOENT",
						}),
					);
				return raw;
			},
			catch: (cause) =>
				cause instanceof MediaHelperUnavailable ||
				cause instanceof MediaProcessFailed
					? cause
					: MediaResponseInvalid.fromCause(cause),
		});
	return {
		read: Effect.fn("SystemMedia.windowsRead")(function* () {
			const raw = yield* call().pipe(Effect.flatMap(decode));
			return yield* Effect.try({
				try: () => {
					const value = Schema.decodeUnknownSync(Reading)(raw);
					return value.session
						? {
								session: {
									...value.session,
									coverUrl:
										value.artwork && value.artworkMime
											? cover(value.artwork, value.artworkMime)
											: null,
								},
								source: value.source,
								commands: new Set(value.commands),
							}
						: null;
				},
				catch: MediaResponseInvalid.fromCause,
			});
		}),
		control: Effect.fn("SystemMedia.windowsControl")(function* (
			action: NativeMediaAction,
			reading: NativeMediaReading,
		) {
			const raw = yield* call({ action, source: reading.source }).pipe(
				Effect.flatMap(decode),
			);
			return yield* Effect.try({
				try: () =>
					Schema.decodeUnknownSync(Schema.Struct({ accepted: Schema.Boolean }))(
						raw,
					).accepted,
				catch: MediaResponseInvalid.fromCause,
			});
		}),
	};
};
