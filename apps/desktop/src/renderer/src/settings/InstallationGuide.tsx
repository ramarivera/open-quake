import { useEffect, useId, useRef, useState } from "react";
import { useAppLocale } from "../i18n";
import "./settings.css";

const copy = {
	en: {
		open: "Installation Guide",
		close: "Close installation guide",
		title: "Quake Hardware Installation Guide",
		steps: ["Connect Cables", "Desktop Setup", "Laptop Setup"],
		titles: [
			"Connect Quake's Included Cables",
			"Connect to Desktop",
			"Connect to Laptop (via Hub)",
		],
		instructions: [
			[
				"Plug the cable's USB-C connector into the Quake unit's left USB-C input port",
				"Plug the cable's Mini HDMI connector into the Quake unit's left Mini HDMI input port",
				'Fully insert the cables. You\'ll hear a "click" when the latch engages.',
				"Box Contents: Quake unit × 1, USB-C cable × 1, Mini HDMI cable × 1",
			],
			[
				"Plug the cable's USB-A connector into your desktop's USB-A port",
				"Plug the cable's HDMI connector into your desktop's HDMI port",
				"Requirement: Desktop must have USB and HDMI ports",
				"Only DisplayPort available? Use an adapter from your PC's DisplayPort output to Quake's HDMI input. HDMI-to-DisplayPort adapters work in the opposite direction.",
			],
			[
				"Plug the cable's USB-A and HDMI connectors into the Hub's matching ports",
				"Plug the Hub's USB-C connector into your laptop's USB-C port that supports DP functionality",
				"The laptop's USB-C port must support DisplayPort video output. A USB-only hub cannot carry the Quake display signal.",
			],
		],
	},
	zh: {
		open: "安装指南",
		close: "关闭安装指南",
		title: "Quake 硬件安装指南",
		steps: ["连接线缆", "连接台式机", "连接笔记本"],
		titles: ["连接 Quake 自带线缆", "连接台式机", "连接笔记本（通过 Hub）"],
		instructions: [
			[
				"将线缆的 USB-C 接头，插入 Quake 机身左侧的 USB-C 输入口",
				"将线缆的 Mini HDMI 接头，插入 Quake 机身左侧的 Mini HDMI 输入口",
				"请完全插紧线缆，听到卡扣咔嗒声即表示到位",
				"包装内容：Quake 主机 × 1、USB-C 线 × 1、Mini HDMI 线 × 1",
			],
			[
				"将线缆的 USB-A 接头，插入台式机的 USB-A 接口",
				"将线缆的 HDMI 接头，插入台式机的 HDMI 接口",
				"要求：台式机需具备 USB 和 HDMI 接口",
				"若仅有 DisplayPort 输出，请使用从电脑 DisplayPort 输出转至 Quake HDMI 输入的适配器。HDMI 转 DisplayPort 适配器方向相反。",
			],
			[
				"将线缆的 USB-A 与 HDMI 接头，分别插入 Hub 的对应接口",
				"将 Hub 的 USB-C 接头，插入笔记本支持 DP 功能的 USB-C 接口",
				"笔记本 USB-C 接口必须支持 DisplayPort 视频输出。仅支持 USB 数据的 Hub 无法传输 Quake 显示信号。",
			],
		],
	},
} as const;

/** Offline help owns its language and resets each time it is opened. */
export function InstallationGuide(): React.JSX.Element {
	const appLocale = useAppLocale();
	const [open, setOpen] = useState(false);
	const opener = useRef<HTMLButtonElement>(null);
	return (
		<>
			<button
				ref={opener}
				type="button"
				className="mc-button"
				onClick={() => setOpen(true)}
			>
				{appLocale.locale === "de"
					? "Installationsanleitung"
					: appLocale.locale === "zh"
						? copy.zh.open
						: copy.en.open}
			</button>
			{open ? (
				<InstallationDialog
					onClose={() => {
						setOpen(false);
						opener.current?.focus();
					}}
				/>
			) : null}
		</>
	);
}

export function InstallationDialog({
	onClose,
}: {
	onClose: () => void;
}): React.JSX.Element {
	const [locale, setLocale] = useState<"en" | "zh">("en");
	const [step, setStep] = useState(0);
	const dialog = useRef<HTMLDialogElement>(null);
	const id = useId();
	const text = copy[locale];
	useEffect(() => {
		const node = dialog.current;
		if (node && !node.open) node.showModal();
		return () => node?.close();
	}, []);
	return (
		<dialog
			ref={dialog}
			className="guide-dialog installation-dialog"
			aria-labelledby={id}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
			onKeyDown={(event) => {
				if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
				event.preventDefault();
				setStep((current) =>
					Math.max(
						0,
						Math.min(2, current + (event.key === "ArrowRight" ? 1 : -1)),
					),
				);
			}}
		>
			<div className="guide-frame" lang={locale}>
				<header className="guide-header">
					<h2 id={id}>{text.title}</h2>
					<fieldset className="button-row" aria-label="Guide language">
						<button
							type="button"
							className="mc-button"
							aria-pressed={locale === "en"}
							onClick={() => setLocale("en")}
						>
							EN
						</button>
						<button
							type="button"
							className="mc-button"
							aria-pressed={locale === "zh"}
							onClick={() => setLocale("zh")}
						>
							中文
						</button>
						<button
							type="button"
							className="mc-button"
							aria-label={text.close}
							onClick={onClose}
						>
							×
						</button>
					</fieldset>
				</header>
				<nav
					className="installation-tabs"
					aria-label={locale === "zh" ? "安装步骤" : "Installation steps"}
				>
					{text.steps.map((label, index) => (
						<button
							key={label}
							type="button"
							className="mc-button"
							aria-current={step === index ? "step" : undefined}
							onClick={() => setStep(index)}
						>
							{index + 1}. {label}
						</button>
					))}
				</nav>
				<article className="installation-body" aria-live="polite">
					<p className="setup-meta">{step + 1} / 3</p>
					<h3>{text.titles[step]}</h3>
					<CableDiagram step={step} />
					<ol>
						{text.instructions[step]?.map((line) => (
							<li key={line}>{line}</li>
						))}
					</ol>
				</article>
			</div>
		</dialog>
	);
}

/** Original vector instructions, not copied vendor artwork. */
function CableDiagram({ step }: { step: number }): React.JSX.Element {
	const left =
		step === 0
			? "QUAKE · left ports"
			: step === 1
				? "DESKTOP"
				: "LAPTOP · USB-C with DP";
	const right =
		step === 0 ? "INCLUDED CABLES" : step === 1 ? "QUAKE" : "HUB → QUAKE";
	return (
		<svg
			className="installation-diagram"
			viewBox="0 0 640 150"
			role="img"
			aria-label={`${left}: USB and HDMI connection diagram`}
		>
			<title>{`${left} to ${right}`}</title>
			<g fill="none" stroke="currentColor" strokeWidth="2">
				<rect x="18" y="20" width="210" height="110" rx="8" />
				<rect x="412" y="20" width="210" height="110" rx="8" />
				<path d="M228 64h184M228 98h184" />
			</g>
			<g fill="currentColor" fontSize="13" textAnchor="middle">
				<text x="122" y="49">
					{left}
				</text>
				<text x="517" y="49">
					{right}
				</text>
				<text x="320" y="57">
					{step === 0
						? "USB-C → USB-A"
						: step === 2
							? "USB-C · DP video + USB"
							: "USB-A · power + data"}
				</text>
				<text x="320" y="118">
					{step === 0 ? "Mini HDMI → HDMI" : "HDMI · display"}
				</text>
			</g>
		</svg>
	);
}
