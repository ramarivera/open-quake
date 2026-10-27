import type { ProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { useState } from "react";
import { Row } from "../ui/Form";
export function GameModeSettings({value, onChange}: {value: ProfileKey; onChange: (value: ProfileKey) => void}): React.JSX.Element {
    const [error, setError] = useState("");
    const path = value.config.actions.find((a) => a.type === "path")?.value;
    const monitor = value.config.actions.some((a) => a.type === "monitorAppView" && a.value === true);
    const change = (type: string, next: string | boolean) => onChange({...value, config: {...value.config, actions: [...value.config.actions.filter((a) => a.type !== type), {type, value: next}]}});
    const choose = async (kind: "file" | "folder" | "application") => {
        try {
            const reply = await window.quakeHardware?.request({_tag: "chooseGameTarget", kind});
            if (typeof reply === "object" && reply !== null && "_tag" in reply && reply._tag === "gameTarget" && "path" in reply && typeof reply.path === "string") change("path", reply.path);
        } catch {setError("Target picker is unavailable");}
    };
    return <><Row label="Target"><input aria-label="Game target" value={typeof path === "string" ? path : ""} onChange={(e) => change("path", e.target.value)} />{(["application", "file", "folder"] as const).map((kind) => <button type="button" key={kind} onClick={() => void choose(kind)}>Choose {kind}</button>)}</Row><Row label="Show foreground application" htmlFor="game-monitor"><input id="game-monitor" type="checkbox" checked={monitor} onChange={(e) => change("monitorAppView", e.target.checked)} /></Row>{error && <p role="alert">{error}</p>}</>;
}
