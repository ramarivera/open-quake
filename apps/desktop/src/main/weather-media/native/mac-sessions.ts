import { Effect, Schema } from "effect";
import {
	MediaSession,
	MediaSource,
} from "../../../shared/weather-media-contracts";
import { MediaResponseInvalid } from "./errors";
import type { NativeMediaResult } from "./metadata";
import type { MediaProcess } from "./process";

/** Fixed JXA. It inspects running players only; it never launches an application. */
export const macSessionsScript = `
ObjC.import('AppKit'); ObjC.import('Foundation');
function env(name) { var value=$.NSProcessInfo.processInfo.environment.objectForKey(name); return value ? ObjC.unwrap(value) : ''; }
function run() {
 var allowed=['com.apple.Music','com.spotify.client'];
 var running=ObjC.unwrap($.NSWorkspace.sharedWorkspace.runningApplications);
 var sessions=[];
 for(var i=0;i<running.length;i++) {
  var item=running[i], bundle=ObjC.unwrap(item.bundleIdentifier);
  if(allowed.indexOf(bundle)<0)continue;
  sessions.push({id:bundle+':'+item.processIdentifier,appId:bundle,appName:ObjC.unwrap(item.localizedName),playing:false});
 }
 var target=env('OPEN_QUAKE_MEDIA_TARGET');
 var selected=sessions.filter(function(s){return s.id===target;})[0];
 if(!selected)return JSON.stringify({sessions:sessions,session:null,source:'',commands:[]});
 var app=Application(selected.appId);
 if(!app.running())return JSON.stringify({sessions:sessions,session:null,source:'',commands:[]});
 var request=env('OPEN_QUAKE_MEDIA_REQUEST');
 if(request) {
  var action=JSON.parse(request).action;
  switch(action) {
   case 'play':app.play();break;
   case 'pause':app.pause();break;
   case 'stop':app.stop();break;
   case 'previous':app.previousTrack();break;
   case 'next':app.nextTrack();break;
   case 'rewind':app.playerPosition=Math.max(0,app.playerPosition()-15);break;
   case 'forward':app.playerPosition=Math.min(app.currentTrack.duration()/(selected.appId==='com.spotify.client'?1000:1),app.playerPosition()+15);break;
   default:return '{"accepted":false}';
  }
  return '{"accepted":true}';
 }
 var track=app.currentTrack, playing=app.playerState()==='playing';
 selected.playing=playing;
 var lyrics='';
 if(selected.appId==='com.apple.Music') { try {lyrics=String(track.lyrics()||'').slice(0,100000);}catch(e){} }
 var duration=Math.max(0,Number(track.duration())*(selected.appId==='com.spotify.client'?1:1000));
 return JSON.stringify({sessions:sessions,session:{id:selected.id,appId:selected.appId,appName:selected.appName,title:String(track.name()||'').slice(0,1000),artist:String(track.artist()||'').slice(0,1000),playing:playing,coverUrl:null,durationMs:duration,positionMs:Math.max(0,Math.min(duration,app.playerPosition()*1000)),canPlay:true,canPause:true,canPrevious:true,canNext:true},source:selected.appId,commands:[0,1,3,4,5,12,13],lyrics:lyrics});
}
`;
const Response = Schema.Struct({
	sessions: Schema.Array(MediaSource).pipe(Schema.maxItems(128)),
	session: Schema.NullOr(MediaSession),
	source: Schema.String.pipe(Schema.maxLength(300)),
	commands: Schema.Array(Schema.Int).pipe(Schema.maxItems(256)),
	lyrics: Schema.optionalWith(Schema.String.pipe(Schema.maxLength(100000)), {
		exact: true,
	}),
});
export const macSessions = (run: MediaProcess, target?: string | null) =>
	run(
		"/usr/bin/osascript",
		["-l", "JavaScript", "-e", macSessionsScript],
		target ? { OPEN_QUAKE_MEDIA_TARGET: target } : {},
	).pipe(
		Effect.flatMap((text) =>
			Effect.try({
				try: (): NativeMediaResult => {
					const value = Schema.decodeUnknownSync(Schema.parseJson(Response))(
						text,
					);
					return { ...value, commands: new Set(value.commands) };
				},
				catch: MediaResponseInvalid.fromCause,
			}),
		),
	);
export const controlMacSession = (
	run: MediaProcess,
	target: string,
	action: string,
) =>
	run("/usr/bin/osascript", ["-l", "JavaScript", "-e", macSessionsScript], {
		OPEN_QUAKE_MEDIA_TARGET: target,
		OPEN_QUAKE_MEDIA_REQUEST: JSON.stringify({ action }),
	}).pipe(
		Effect.flatMap((text) =>
			Effect.try({
				try: () =>
					Schema.decodeUnknownSync(
						Schema.parseJson(Schema.Struct({ accepted: Schema.Boolean })),
					)(text).accepted,
				catch: MediaResponseInvalid.fromCause,
			}),
		),
	);
