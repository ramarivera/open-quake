import { Effect, Schema } from "effect";
import {
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
} from "../../../../../../packages/device/src/knob/knob-errors";
import { VolumeReading } from "../../../../../../packages/device/src/knob/model/contracts";
import { macVolume, script } from "../../knob/native-volume";
import type { HostVolumePort } from "../host-volume";
import { type MediaProcess, mediaProcess } from "./process";

/** CoreAudio default render endpoint. Data never becomes executable PowerShell. */
export const windowsVolumeScript = `
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Devices {
 [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr result);
 [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out Device device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Device {
 [PreserveSig] int Activate(ref Guid id, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.Interface)] out Endpoint endpoint);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Endpoint {
 [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
 [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
 [PreserveSig] int GetChannelCount(out uint count);
 [PreserveSig] int SetMasterVolumeLevel(float value, ref Guid context);
 [PreserveSig] int SetMasterVolumeLevelScalar(float value, ref Guid context);
 [PreserveSig] int GetMasterVolumeLevel(out float value);
 [PreserveSig] int GetMasterVolumeLevelScalar(out float value);
 [PreserveSig] int SetChannelVolumeLevel(uint channel, float value, ref Guid context);
 [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float value, ref Guid context);
 [PreserveSig] int GetChannelVolumeLevel(uint channel, out float value);
 [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float value);
 [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid context);
 [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
}
public static class HostAudio {
 static Endpoint Open() {
  var devices=(Devices)new Enumerator(); Device device;
  Marshal.ThrowExceptionForHR(devices.GetDefaultAudioEndpoint(0,1,out device));
  var id=typeof(Endpoint).GUID; Endpoint endpoint;
  Marshal.ThrowExceptionForHR(device.Activate(ref id,23,IntPtr.Zero,out endpoint));
  Marshal.ReleaseComObject(device); Marshal.ReleaseComObject(devices); return endpoint;
 }
 public static string Read() {
  var endpoint=Open();try {float value;bool muted;Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out value));Marshal.ThrowExceptionForHR(endpoint.GetMute(out muted));return "{\\"level\\":"+Math.Round(value*100).ToString(System.Globalization.CultureInfo.InvariantCulture)+",\\"muted\\":"+muted.ToString().ToLowerInvariant()+"}";}finally{Marshal.ReleaseComObject(endpoint);}
 }
 public static void Write(float value,bool muted) {
  var endpoint=Open();try {var context=Guid.Empty;Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(value/100,ref context));Marshal.ThrowExceptionForHR(endpoint.SetMute(muted,ref context));}finally{Marshal.ReleaseComObject(endpoint);}
 }
}
'@
if ($env:OPEN_QUAKE_VOLUME_REQUEST) { $request=$env:OPEN_QUAKE_VOLUME_REQUEST | ConvertFrom-Json; [HostAudio]::Write([float]$request.level,[bool]$request.muted) }
[HostAudio]::Read()
`;
export function nativeHostVolume(
	platform: string,
	mock = false,
	run: MediaProcess = mediaProcess,
): HostVolumePort {
	const unavailable = Effect.fail(KnobCapabilityUnavailable.fromCause());
	if (mock || !["darwin", "win32"].includes(platform))
		return { read: unavailable, write: () => unavailable };
	if (platform === "darwin")
		return {
			read: macVolume,
			write: (reading) =>
				script(
					`set volume output volume ${reading.level} output muted ${reading.muted ? "true" : "false"}`,
				).pipe(Effect.asVoid),
		};
	const call = (reading?: VolumeReading) =>
		run(
			"powershell.exe",
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				Buffer.from(windowsVolumeScript, "utf16le").toString("base64"),
			],
			reading ? { OPEN_QUAKE_VOLUME_REQUEST: JSON.stringify(reading) } : {},
		).pipe(
			Effect.mapError(KnobDispatchFailed.fromCause),
			Effect.flatMap((text) =>
				Schema.decodeUnknown(Schema.parseJson(VolumeReading))(text).pipe(
					Effect.mapError(KnobDispatchFailed.fromCause),
				),
			),
		);
	return {
		read: call(),
		write: (reading) =>
			Schema.decodeUnknown(VolumeReading)(reading).pipe(
				Effect.mapError(KnobDispatchFailed.fromCause),
				Effect.flatMap(call),
				Effect.asVoid,
			),
	};
}
