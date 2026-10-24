import { type ReactNode, useId } from "react";

/** Building blocks for the management window: grouped, label-left forms. */

export function PageHeader({
	title,
	description,
	children,
}: {
	title: string;
	description?: ReactNode;
	children?: ReactNode;
}): React.JSX.Element {
	return (
		<header className="page-header">
			<div>
				<h1>{title}</h1>
				{description ? <p className="page-description">{description}</p> : null}
			</div>
			{children ? <div className="page-actions">{children}</div> : null}
		</header>
	);
}

export function Group({
	title,
	description,
	children,
	footer,
}: {
	title: string;
	description?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
}): React.JSX.Element {
	const id = useId();
	return (
		<section className="group" aria-labelledby={id}>
			<div className="group-heading">
				<h2 id={id}>{title}</h2>
				{description ? (
					<p className="group-description">{description}</p>
				) : null}
			</div>
			<div className="group-box">{children}</div>
			{footer ? <div className="group-footer">{footer}</div> : null}
		</section>
	);
}

export function Row({
	label,
	hint,
	htmlFor,
	labelId,
	children,
	align = "center",
}: {
	label: ReactNode;
	hint?: ReactNode;
	/** Associates the visible label with a single control. */
	htmlFor?: string;
	/** Lets a composite control (radio group) reference the visible label. */
	labelId?: string;
	children?: ReactNode;
	align?: "center" | "start";
}): React.JSX.Element {
	return (
		<div className="row" data-align={align}>
			<div className="row-label">
				{htmlFor ? (
					<label htmlFor={htmlFor} id={labelId}>
						{label}
					</label>
				) : (
					<span id={labelId}>{label}</span>
				)}
				{hint ? <span className="row-hint">{hint}</span> : null}
			</div>
			{children ? <div className="row-control">{children}</div> : null}
		</div>
	);
}

export type SegmentOption<T extends string> = {
	readonly value: T;
	readonly label: string;
	readonly disabled?: boolean;
};

/** Native radios styled as a macOS segmented control; arrow keys still work. */
export function Segmented<T extends string>({
	name,
	labelledBy,
	value,
	options,
	disabled = false,
	onChange,
}: {
	name: string;
	labelledBy: string;
	value: T;
	options: ReadonlyArray<SegmentOption<T>>;
	disabled?: boolean;
	onChange: (value: T) => void;
}): React.JSX.Element {
	return (
		<div
			className="segmented"
			role="radiogroup"
			aria-labelledby={labelledBy}
			aria-disabled={disabled || undefined}
		>
			{options.map((option) => (
				<label key={option.value} className="segment">
					<input
						type="radio"
						name={name}
						value={option.value}
						checked={option.value === value}
						disabled={disabled || option.disabled}
						onChange={() => onChange(option.value)}
					/>
					<span>{option.label}</span>
				</label>
			))}
		</div>
	);
}

export function StatusDot({ tone }: { tone: string }): React.JSX.Element {
	return <span className="status-dot" data-tone={tone} aria-hidden="true" />;
}

export function Callout({
	tone = "info",
	children,
}: {
	tone?: "info" | "warning";
	children: ReactNode;
}): React.JSX.Element {
	return (
		<p className="callout" data-tone={tone}>
			{children}
		</p>
	);
}
