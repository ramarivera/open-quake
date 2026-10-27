import { Effect, Schema } from "effect";
import { HardwareCommandRejected } from "./hardware-errors.js";

const Bytes = Schema.Array(Schema.Uint8).pipe(Schema.maxItems(28));
/** QMK legacy and v3 custom menus share commands 7/8/9. No arbitrary raw opcode. */
export const QmkOperation = Schema.Union(
    Schema.TaggedStruct("protocol", {}),
    Schema.TaggedStruct("get", {prefix: Bytes.pipe(Schema.minItems(1)), length: Schema.Int.pipe(Schema.between(1, 29))}),
    Schema.TaggedStruct("set", {prefix: Bytes.pipe(Schema.minItems(1)), values: Bytes.pipe(Schema.minItems(1))}),
    Schema.TaggedStruct("save", {channel: Schema.optional(Schema.Uint8)}),
).pipe(Schema.filter((op) => op._tag === "protocol" || op._tag === "save" || 1 + op.prefix.length + (op._tag === "get" ? op.length : op.values.length) <= 32));
export type QmkOperation = typeof QmkOperation.Type;
export const importQmkOperations = (input: unknown) => Schema.decodeUnknown(Schema.Array(QmkOperation).pipe(Schema.minItems(1), Schema.maxItems(64)))(input).pipe(Effect.mapError((cause) => new HardwareCommandRejected(cause)));
export function qmkOperationBytes(op: QmkOperation): { report: Uint8Array; prefix: readonly number[]; length: number } {
    const bytes = op._tag === "protocol" ? [1] : op._tag === "save" ? [9, ...(op.channel === undefined ? [] : [op.channel])] : [op._tag === "get" ? 8 : 7, ...op.prefix, ...(op._tag === "set" ? op.values : [])];
    const report = new Uint8Array(33);
    report.set(bytes, 1);
    return {report, prefix: bytes, length: op._tag === "protocol" ? 2 : op._tag === "get" ? op.length : 0};
}
