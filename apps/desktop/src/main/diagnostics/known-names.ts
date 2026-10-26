// Static application names only. Unknown names and paths never serialize.
// Update this allowlist when a new source file, named span, log event or error tag is added.
export const knownSpans = new Set(
	`SoundboardImporter.preview SoundboardFiles.inspect
SystemMedia.nativeProcess SystemMedia.macRead SystemMedia.macControl SystemMedia.windowsRead SystemMedia.windowsControl SystemMedia.nativeRead SystemMedia.nativeControl SystemMedia.keyAction SystemMediaService.send
GeneralSettingsService.snapshot GeneralSettingsService.loginStatus GeneralSettingsService.save GeneralSettingsService.startup
WizardService.snapshot WizardService.save WizardService.seedRegion WizardService.replay WizardService.complete SettingsRepository.transact
DesktopSettings.login DesktopSettings.setLogin DesktopSettings.workAreas DesktopSettings.managementReachable DesktopWizard.displayAvailable DesktopWizard.usableProfiles
SettingsService.locale SettingsService.setLocale SettingsRepository.read SettingsRepository.setLocale
DesktopKnob.nativeScript DesktopKnob.readVolume DesktopKnob.load DesktopKnob.focusedHotkey DesktopKnob.focusedKey DesktopKnob.focusedBrightness DesktopKnob.warmThumbnails DesktopKnob.thumbnail DesktopKnob.selectProfile DesktopKnob.observeVolume
DesktopBrightness.step DesktopBrightness.process DesktopBrightness.macRead DesktopBrightness.macWrite DesktopBrightness.windowsRead DesktopBrightness.windowsWrite DesktopBrightness.linuxRead DesktopBrightness.linuxWrite
ForegroundApp.acquire ForegroundApp.dispose
ChatService.read ChatService.attach ChatService.submit ChatService.turn ChatService.cancel ChatService.close ChatService.clear ChatService.snapshot ChatService.subscribe ChatService.session ChatService.rename ChatService.supersede ChatService.history ChatService.list
ChatRepository.get ChatRepository.list ChatRepository.put ChatRepository.remove ChatInference.open FileChatStorage.save PinnedAiRepository.get PinnedAiRepository.put VercelCompatibleAdapter.open
DesktopChat.submit DesktopChat.subscribe DesktopChat.snapshot DesktopChat.cancel DesktopChat.close DesktopChat.clear DesktopChat.rename DesktopChat.history DesktopChat.list DesktopChat.credentials
DesktopSpeech.create DesktopSpeech.createRuntime DesktopSpeech.runtime DesktopSpeech.settings DesktopSpeech.settingsView DesktopSpeech.cleanupCredentials DesktopSpeech.request DesktopSpeech.reset DesktopSpeech.observe DesktopSpeech.readAloud
DesktopSpeech.profiles DesktopSpeech.configure DesktopSpeech.cancelSpeech DesktopSpeech.stopCapture
DesktopSpeech.credentials DesktopSpeech.resolveCredential DesktopSpeech.credentialRevoked
DesktopSpeech.storeCredential DesktopSpeech.removeCredential DesktopSpeech.ordered
DesktopSpeech.cancelOrdered DesktopSpeech.flushOrdered DesktopSpeech.pushOrdered DesktopSpeech.finishOrdered
ActionService.activate ActionService.execute AgentConnections.create AgentConnections.get
AgentConnections.remove AgentConnections.resolveCredential AgentConnections.save
AgentConnections.select AgentConnections.selected AgentConnections.view AgentHttp.connect
AgentHttp.createRuntimeRegistry AgentHttp.createVoiceAdapter AgentHttp.disconnect
AgentHttp.draftAgent AgentHttp.draftSkill AgentHttp.draftText AgentHttp.invalidateConnection
AgentHttp.readConnection AgentHttp.refreshConnection AgentHttp.resolveProductionRuntime
AgentHttp.resolveRuntime AgentHttp.resources.capabilities AgentHttp.resources.discover
AgentHttp.resources.listAgents AgentHttp.resources.listModels AgentHttp.resources.listResources
AgentHttp.resources.listSessions AgentsDraft.agent AgentsDraft.generate AgentsDraft.skill
AgentsPanel.apply AgentsPanel.prepare AgentsPanel.rollback AgentsRepository.load
AgentsRepository.read AgentsRepository.transact AgentsRuntime.control AgentsRuntime.read
AgentsService.request AgentsService.resolve AgentsService.view AiProviderService.cancel
AiProviderService.createSpeech AiProviderService.generate AiProviderService.openCompatible
AiProviderService.recognize AiProviderService.stopMeetingTranslation AiProviderService.stream
AiProviderService.synthesize AiProviderService.transcribeMeeting AiProviderService.translateMeeting
AiRepository.get AiRepository.put AiSpeechService.cancel AiSpeechService.createSpeech
AiSpeechService.recognize AiSpeechService.synthesize AiSpeechService.validate AiVoiceService.submit
AppUpdates.check AppUpdates.defer AppUpdates.download AppUpdates.install AppUpdates.snapshot
ChannelService.approve ChannelService.cancelQr ChannelService.dispose ChannelService.list
ChannelService.loadStore ChannelService.pairings ChannelService.readQr ChannelService.remove
ChannelService.save ChannelService.setEnabled ChannelService.startQr Clock.handleCommand
ClockStore.commitMedia ClockStore.load ClockStore.loadFile ClockStore.mediaPath ClockStore.project
ClockStore.read ClockStore.restoreMedia ClockStore.setMode ClockStore.setSeconds ClockStore.setTheme
ClockStore.stageMedia ConversationRepository.append ConversationRepository.begin
ConversationRepository.clear ConversationRepository.finish ConversationRepository.history
ConversationService.cancel ConversationService.cancelOwner ConversationService.clear
ConversationService.history ConversationService.shutdown ConversationService.stream
CredentialVault.remove CredentialVault.resolve CredentialVault.revoked CredentialVault.store
DataReset.run DesktopBackup.export DesktopDeviceBus.recover DesktopDeviceBus.start
DesktopKeys.insertText DesktopKeys.launchApplication DesktopKeys.pressChord DesktopMaintenance.view
DeviceLifecycle.lock DeviceLifecycle.onStatus DeviceLifecycle.redetect DeviceLifecycle.topology
DeviceLifecycle.wake DisplayPrompts.check DisplayPrompts.make DisplayPrompts.repair
EmojiDesktop.addGif EmojiDesktop.controller EmojiDesktop.request EmojiDesktop.snapshot
EmojiLibrary.command EmojiPress.press EmojiRepository.read EmojiRepository.transact
FakeHidTransport.close FakeHidTransport.discover FakeHidTransport.open FakeHidTransport.write
FirmwareUpdates.cancel FirmwareUpdates.close FirmwareUpdates.recover FirmwareUpdates.snapshot
FirmwareUpdates.start FirmwareUpdates.write ForegroundApp.probe GridVoice.input GridVoice.knob
GridVoice.reset GridVoice.sendText HardwareControls.configure HardwareControls.create
HardwareControls.enterDfu HardwareControls.flush HardwareControls.playTone
HardwareControls.pressChord HardwareControls.readVersion HardwareControls.refresh
HardwareControls.send HardwareControls.setInputMode HardwareControls.setLocked
HardwareControls.snapshot HardwareControls.stepBrightness HardwareControls.toggleMic
HardwareKeyboard.pressChord Hermes.capabilities Hermes.decodeFrame Hermes.discovery Hermes.execute
Hermes.health Hermes.listAgents Hermes.listModels HomeAssistantService.aiEntities
HomeAssistantService.allowlist HomeAssistantService.connect HomeAssistantService.dispose
HomeAssistantService.execute HomeAssistantService.live HomeAssistantService.load
HomeAssistantService.poll HomeAssistantService.revoke HomeAssistantService.saveKey
HomeAssistantService.setVisible HomeAssistantService.snapshot HomeAssistantService.trust
IconRepository.add IconRepository.addLocal IconRepository.read IconRepository.write
ImageDecoder.decode Integrations.dispatch Integrations.request KeyEditing.commit KeyEditing.discard
KeyEditing.locate KeyEditing.preview KeyEditing.read KeyEditing.remove KeyEditing.revert
KeyEditing.save KeyRuntime.activate KeyRuntime.feedback KeyRuntime.navigate KeyRuntime.refresh
KeyRuntime.reset KnobModel.configure KnobModel.dispatch KnobModel.snapshot KnobModel.synchronize
KnobService.dispatch KnobService.execute KnobService.handle KnobService.readSnapshot
LightingDevice.checkBinding LightingDevice.exchange LightingDevice.open LightingDevice.read
LightingDevice.resolve LightingService.deselect LightingService.flush LightingService.save
LightingService.select LightingService.setDesired LightingService.state MediaController.make
MediaController.request MediaController.snapshot MediaFiles.atomicWrite MediaFiles.collectAssets
MediaFiles.collectLegacyAssets MediaFiles.readAsset MediaFiles.readLocal MediaFiles.readSettings
MediaFiles.storeAsset MediaFiles.writeSettings MediaRepository.importLocal MediaRepository.load
MediaRepository.resolve MediaRepository.restore MediaRepository.save MediaRepository.saveUnlocked
MediaRepository.validate MeetingProvider.summarize MeetingRepository.commit
MeetingRepository.deleteAudio MeetingRepository.list MeetingRepository.remove
MeetingRepository.update MeetingService.action MeetingService.addTranslation MeetingService.cancel
MeetingService.clear MeetingService.configure MeetingService.delete MeetingService.find
MeetingService.generate MeetingService.patch MeetingService.process MeetingService.publish
MeetingService.regenerate MeetingService.rename MeetingService.shutdown MeetingService.snapshot
MeetingService.sourceLost MeetingService.start MeetingService.stop MeetingService.stopTranslation
MeetingService.subscribe MeetingService.suspend MeetingService.tab MeetingService.template
MeetingService.translate MeetingService.translationLost MockHardwareBus.start MonitorService.watch
MonitoringService.snapshot MonitoringService.subscribe MonitoringService.configure MonitorForeground.query MonitorForeground.stop
MonitorStore.configuration MonitorStore.read MonitorStore.save MonitorStore.stage NativeDisplay.call
NativeDisplay.hiddenMirroring NodeHidTransport.close NodeHidTransport.discover NodeHidTransport.open
NodeHidTransport.write OpenClawAdapter.authenticated OpenClawAdapter.capabilities
OpenClawAdapter.catalog OpenClawAdapter.health OpenClawAdapter.listAgents
OpenClawAdapter.probeProtocol ProfileDesktop.batch ProfileDesktop.capture ProfileDesktop.controller
ProfileDesktop.publish ProfileDesktop.request ProfileDesktop.view
ProfileFunctionContracts.dispatchSnapshot ProfileFunctionContracts.validateProfile
ProfileManager.command ProfileManager.install ProfileManager.read ProfileRepository.load
ProfileRepository.loadUnlocked ProfileRepository.save ProfileRepository.select
ProfileRepository.snapshot ProfileRepository.transact ProfileRepository.write
ProfileService.getProfile ProfileService.loadProfiles ProfileService.saveProfile
ProfileService.selectProfile ProfileService.subscribeCommittedProfiles
ProfileService.subscribeDispatchProfiles ProfileSwitching.connect ProfileSwitching.connectedSerials
ProfileSwitching.deliver ProfileSwitching.disconnect ProfileSwitching.probe
ProfileSwitching.redeliverSelected ProfileSwitching.request ProfileSwitching.selectNow ProfileSwitching.sessionOwnership
QuakeConnection.disconnect QuakeConnection.recoverReads QuakeConnection.sendHardware
QuakeConnection.subscribe QuakeDevice.connect QuakeDevice.disconnect QuakeDevice.discover
RuntimeHttpTransport.execute RuntimeHttpTransport.readJson ShortcutService.generate
ShortcutService.list ShortcutService.remove ShortcutService.save ShortcutService.sync
StripDiscovery.make StripDiscovery.run SystemMediaService.control SystemMediaService.read
SystemMediaService.update TouchInput.rearm TouchInput.release TouchInput.report TouchInput.reset
TouchInput.session TouchInput.setCaptureActive TouchInput.setLocked TouchInput.start TouchInput.wake
VoiceSurface.activeFlow VoiceSurface.agentStatus VoiceSurface.publish VoiceSurface.rejectBusy
VoiceSurface.reserve WeatherMediaController.configure WeatherMediaController.read
WeatherMediaController.request WeatherMediaController.weather WeatherNetwork.json
WeatherService.autoCity WeatherService.fetch WeatherService.forecast WeatherService.search
WeatherService.verifyCity`.split(/\s+/),
);

export const knownSourceFiles = new Set(
	`composition.ts capture.ts electron-audio.ts audio-worker.ts pcm.ts factory.ts settings.ts settings-ipc.ts websocket.ts ordered.ts runtime.ts errors.ts
general-service.ts general-invariants.ts general-contracts.ts wizard-service.ts wizard-invariants.ts wizard-contracts.ts backend-rpc.ts backend-preload.ts os-adapter.ts wizard-owners.ts window-binding.ts
native-volume.ts thumbnail-binding.ts volume-observer.ts profile-thumbnail-key.ts profile-thumbnails.ts
windows-foreground.ts windows-foreground-script.ts
account-config.ts action-adapters.ts action-contracts.ts action-errors.ts action-import.ts
action-invariants.ts action-registry.ts action-service.ts adapter.ts agents-contracts.ts
agents-errors.ts agents-invariants.ts agents-ports.ts agents-repository.ts agents-runtime.ts
agents-service.ts ai-contracts.ts ai-credentials.ts ai-errors.ts ai-invariants.ts
ai-provider-quirks.ts ai-repository.ts ai-role-presets.ts ai-router-contracts.ts ai-router-prompt.ts
ai-router-service.ts ai-service.ts ai-test-fixtures.ts ai-workflow-contracts.ts alarm.ts
appearance-backup.ts appearance.ts application-icons.ts archive-fixtures.ts audio-files.ts
backup-archive.ts backup-budget.ts backup-merge-proof.ts backup-merge.ts backup-paths.ts
backup-profile-links.ts backup-proof.ts backup-read.ts backup-store.ts backup-write.ts bus.ts
capture-port.ts channel-catalog.ts channel-contracts.ts channel-service.ts chat-contracts.ts
chat-invariants.ts clipboard.ts clock-backup.ts clock-ipc.ts clock-store.ts connection-controller.ts
connection-preload.ts connection-registration.ts connections.ts contracts.ts controller.ts
conversation-controller.ts conversation-preload.ts conversation-registration.ts
conversation-repository.ts conversation-service.ts credentials.ts desktop-adapters.ts
device-contracts.ts device-errors.ts device-service.ts device-status.ts deviceBus.ts discovery.ts
display-clock.ts display-contracts.ts display-errors.ts display-invariants.ts display.ts drafting.ts
emoji-backup-merge.ts emoji-contracts.ts emoji-errors.ts emoji-invariants.ts emoji-repository.ts
emoji-service.ts entry.js entry.ts eventForwarding.ts files.ts firmware-files.ts firmware-service.ts
firmware-session.ts font-renderer.ts foreground-app.ts grid-voice-service.ts ha-contracts.ts
ha-invariants.ts ha-rest.ts ha-service.ts hardware-contracts.ts hardware-errors.ts hardware-fake.ts
hardware-invariants.ts hardware-keyboard.ts hardware-repository.ts hardware-service.ts
hermes-adapter.ts hermes-protocol.ts hid-fake.ts hid-transport.ts hid.ts hold-to-talk.ts
icon-backup-proof.ts icon-backup.ts icon-errors.ts icon-pack-fixtures.ts icon-packs.ts
icon-picker.ts icon-store.ts icon-svg.ts image-decoder.ts index.js index.ts installed-apps.ts
integration-errors.ts invariants.ts key-action.ts key-editing-invariants.ts key-editing-service.ts
key-runtime-service.ts keychain.ts knob-contracts.ts knob-dispatch-routing.ts knob-errors.ts
knob-invariants.ts knob-registry.ts knob-service.ts knob-voice-migration.ts lifecycle-service.ts
lighting-contracts.ts lighting-device.ts lighting-errors.ts lighting-invariants.ts
lighting-service.ts local-profile-storage.ts maintenance-errors.ts management-adapter.ts
manager-preload.ts media-controller.ts media-files.ts media-permissions.ts media-repository.ts
meeting-adapter.ts meeting-contracts.ts meeting-defaults.ts meeting-errors.ts meeting-invariants.ts
meeting-ports.ts meeting-provider.ts meeting-repository.ts meeting-service.ts meeting-templates.ts
mock-voice-runtime.ts mock.ts mockDeviceBus.ts monitor-contracts.ts monitor-service.ts
monitor-store.ts native-actions.ts native-collector.ts native-display.ts native-media.ts
native-parsers.ts native-video-probe.ts node-hid.ts package-smoke.ts permissions.ts plain.ts
ports.ts preferences.ts preload.ts preview-smoke.config.ts preview-smoke.ts private-files.ts
profile-binding.ts profile-catalog.ts profile-codec.ts profile-contracts.ts profile-controller.ts
profile-errors.ts profile-fixtures.ts profile-footprint.ts profile-function-contracts.ts
profile-grid.ts profile-invariants.ts profile-ipc.ts profile-manager-contracts.ts
profile-manager-invariants.ts profile-manager-service.ts profile-permissions.ts profile-placement.ts
profile-repository.ts profile-service.ts profile-snapshots.ts profile-switching-invariants.ts
profile-switching-service.ts profiles.ts prompts.ts protocol-adapter.ts protocol.ts
provider-defaults.ts read-recovery.ts registration.ts reset-exit.ts reset-service.ts resources.ts
restore-exit.ts review-grouped-services.ts review-preload.ts review-round-2-smoke.ts
review-round-3-smoke.ts review-smoke.config.ts review-smoke.ts runtime-adapter.ts
runtime-contracts.ts runtime-errors.ts runtime-invariants.ts runtime-port.ts runtime-ports.ts
runtime-registry.ts service.ts settings-repository.ts shortcut-contracts.ts shortcut-invariants.ts
shortcut-service.ts smoke-editor.ts smoke-failure.ts smoke-final-review.ts smoke-font.ts
smoke-icon-review.ts smoke-review.ts smoke-scratch.ts smoke-wait.ts smoke.config.ts smoke.ts
host.ts credentials.ts chat-service.ts chat-repository.ts chat-ports.ts chat-errors.ts chat-invariants.ts rpc-server.ts vercel.ts
speech-audio.ts speech-contracts.ts speech-errors.ts speech-http.ts speech-ports.ts
speech-service.ts speech-stt.ts speech-test-fixtures.ts storage.ts strip-fixtures.ts system-media.ts
test-fixtures.ts touch-contracts.ts touch-fixtures.ts touch-invariants.ts touch-session.ts
touch-source.ts transport-decode.ts transport-fixtures.ts transport-limits.ts transport-sse.ts
transport.ts update-service.ts voice-adapter.ts voice-fixtures.ts voice-surface-contracts.ts
voice-surface-errors.ts voice-surface-invariants.ts voice-surface-ports.ts voice-surface-service.ts
soundboard-import.ts soundboard-invariants.ts soundboard-errors.ts files.ts process.ts metadata.ts macos.ts windows.ts errors.ts key-actions.ts volume-discovery.ts weather-network.ts weather-service.ts zip.ts`.split(
		/\s+/,
	),
);

export const knownLogEvents = new Set([
	"soundboard.file.inspection.failed",
	"Native media request failed",
	"Agent credential cleanup failed; retry pending",
	"Application shutdown failed",
	"Firmware session requires recovery",
	"Foreground profile probe failed",
	"HTTP runtime setup failed",
	"HTTP runtime state update failed",
	"Maintenance initialization failed",
	"Profile session cleanup failed",
	"Profile session enrollment failed",
	"Publishing profiles manager snapshot failed",
	"Refreshing knob profiles failed",
	"Settings window operation failed",
	"Voice tone failed",
	"Speech initialization failed",
	"Wallpaper asset collection deferred: storage unavailable",
	"Wallpaper asset collection skipped: invalid settings",
]);

export const knownErrorTags = new Set(
	`SoundboardConfigInvalid SoundboardFileUnavailable MediaHelperUnavailable MediaProcessFailed MediaResponseInvalid SettingsOsApplyFailed WizardIncomplete SettingsInvalid SettingsReadFailed SettingsPersistFailed ChatBusy ChatContextTooLarge ChatInterrupted ChatInvalid ChatLimitExceeded ChatModeUnavailable ChatNotFound ChatResyncRequired ChatStorageFailed ChatTimeout
ActionApplicationMissing ActionPermissionDenied ActionSnapshotFailed AgentCredentialUnavailable
AgentDraftFailed AgentDraftUnavailable AgentDuplicate AgentInvalid AgentMissing AgentModelInvalid
AgentModelLastRow AgentPanelFailed AgentProfileMissing AgentProtected AgentRevisionConflict
AgentRollbackFailed AgentRuntimeBusy AgentRuntimeFailed AgentRuntimeTimeout AgentRuntimeUnavailable
AgentSlotInvalid AgentStorageFailed AiAuthRequired AiAuthRevoked AiCapabilityUnsupported
AiConfigInvalid AiCredentialStoreFailed AiProtocolInvalid AiRateLimited AiUnavailable
AppUpdateFailed BackupFailed BackupInvalid CredentialFailed DraftUnavailable EmojiClipboardFailed
EmojiForegroundFailed EmojiInvalid EmojiKeyboardFailed EmojiLibraryFailed FirmwareBusy
FirmwareImageInvalid FirmwarePersistenceFailed FirmwareTargetMismatch FirmwareUnavailable
FirmwareVerificationFailed FirmwareVolumeInvalid FirmwareWriteFailed HaAuthenticationFailed
HaCertificateRejected HaNetworkFailed HardwareCommandRejected HardwarePreferencesFailed
HardwareReplyTimeout HardwareUnavailable HostActionFailed IconImportFailed IconStorageFailed
InputRejected InvalidKeyAction InvalidKnobConfig InvalidLightingValue InvalidWallpaper
KeyFunctionUnavailable KnobCapabilityUnavailable KnobDispatchFailed KnobRouteIncomplete
KnobSessionStale LightingApplyFailed LightingIoFailed LightingReadFailed LightingSaveFailed
LightingTargetUnavailable LightingValueUnsupported MaintenanceShutdownFailed MediaPersistenceFailed
MediaUnreadable MeetingCaptureDenied MeetingCaptureFailed MeetingConverterUnavailable
MeetingExportFailed MeetingGenerationFailed MeetingInvalid MeetingSourceLost MeetingStorageFailed
MeetingTimeout MeetingTranscriptionFailed MeetingUnavailable PermissionProbeFailed
ProfileCommandFailed ProfileDeliveryFailed ProfileForegroundFailed ProfileNotFound
ProfilePlacementFailed ProfileReadFailed ProfileRevisionConflict ProfileThumbnailFailed
ProfileThumbnailUnsupported ProfileValidationFailed ProfileWriteFailed QuakeCallbackFailed
QuakeConnectionClosed QuakeConnectionConfigInvalid QuakeDeviceNotFound QuakeHidCloseFailed
QuakeHidDiscoveryFailed QuakeHidOpenFailed QuakeHidReadFailed QuakeHidWriteFailed ResetFailed
ResourceTargetUnverified RestoreFailed RuntimeAuthenticationFailed RuntimeCapabilityUnsupported
RuntimeConnectionInvalid RuntimeCredentialUnavailable RuntimeLimitExceeded RuntimeProtocolInvalid
RuntimeRequestFailed RuntimeStorageFailed RuntimeTimeout RuntimeUnavailable SkillConflict
SkillMoveIncomplete SkillMoved SkillWorkspaceInvalid SpeechFormatUnsupported SpeechPhaseTimeout
StoreFailed DesktopSpeechError VoiceLinkRejected VoiceRuntimeUnavailable VoiceSurfaceRequestFailed
VoiceSurfaceRequestInvalid`.split(/\s+/),
);
