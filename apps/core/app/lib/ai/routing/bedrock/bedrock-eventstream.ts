/**
 * Minimal AWS Event Stream codec for Bedrock ConverseStream.
 * Wire format: https://docs.aws.amazon.com/transcribe/latest/dg/event-stream.html
 *
 * Only string headers are required for ConverseStream (`:event-type`,
 * `:message-type`, `:content-type`). CRC32 is validated on both the prelude
 * and the full message so a truncated or corrupt frame cannot be misread
 * as a later event.
 */

const PRELUDE_LENGTH = 12;
const MESSAGE_CRC_LENGTH = 4;
const HEADER_TYPE_STRING = 7;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint16BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

export type EventStreamMessage = {
  headers: Record<string, string>;
  payload: Uint8Array;
};

export class EventStreamParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventStreamParseError";
  }
}

function parseHeaders(section: Uint8Array): Record<string, string> {
  const headers: Record<string, string> = {};
  let offset = 0;
  const decoder = new TextDecoder();

  while (offset < section.length) {
    const nameLen = section[offset]!;
    offset += 1;
    if (offset + nameLen + 1 > section.length) {
      throw new EventStreamParseError("Truncated event-stream header name");
    }
    const name = decoder.decode(section.subarray(offset, offset + nameLen));
    offset += nameLen;
    const type = section[offset]!;
    offset += 1;

    if (type !== HEADER_TYPE_STRING) {
      throw new EventStreamParseError(`Unsupported event-stream header type ${type} for "${name}"`);
    }
    if (offset + 2 > section.length) {
      throw new EventStreamParseError("Truncated event-stream header value length");
    }
    const valueLen = (section[offset]! << 8) | section[offset + 1]!;
    offset += 2;
    if (offset + valueLen > section.length) {
      throw new EventStreamParseError("Truncated event-stream header value");
    }
    headers[name] = decoder.decode(section.subarray(offset, offset + valueLen));
    offset += valueLen;
  }

  return headers;
}

/**
 * Parse as many complete Event Stream messages as `buffer` contains.
 * Returns leftover bytes that belong to an incomplete trailing message.
 */
export function parseEventStreamMessages(buffer: Uint8Array): {
  messages: EventStreamMessage[];
  rest: Uint8Array;
} {
  const messages: EventStreamMessage[] = [];
  let offset = 0;

  while (offset + PRELUDE_LENGTH <= buffer.length) {
    const totalLength = readUint32BE(buffer, offset);
    const headersLength = readUint32BE(buffer, offset + 4);
    if (totalLength < PRELUDE_LENGTH + MESSAGE_CRC_LENGTH) {
      throw new EventStreamParseError(`Invalid event-stream total length ${totalLength}`);
    }
    if (offset + totalLength > buffer.length) {
      break;
    }

    const message = buffer.subarray(offset, offset + totalLength);
    const preludeCrc = readUint32BE(message, 8);
    if (preludeCrc !== crc32(message.subarray(0, 8))) {
      throw new EventStreamParseError("Event-stream prelude CRC mismatch");
    }
    const messageCrc = readUint32BE(message, totalLength - MESSAGE_CRC_LENGTH);
    if (messageCrc !== crc32(message.subarray(0, totalLength - MESSAGE_CRC_LENGTH))) {
      throw new EventStreamParseError("Event-stream message CRC mismatch");
    }

    const headersStart = PRELUDE_LENGTH;
    const headersEnd = headersStart + headersLength;
    const payloadEnd = totalLength - MESSAGE_CRC_LENGTH;
    if (headersEnd > payloadEnd) {
      throw new EventStreamParseError("Event-stream headers overrun payload");
    }

    messages.push({
      headers: parseHeaders(message.subarray(headersStart, headersEnd)),
      payload: message.subarray(headersEnd, payloadEnd),
    });
    offset += totalLength;
  }

  return {
    messages,
    rest: offset === 0 ? buffer : buffer.subarray(offset),
  };
}

function encodeStringHeaders(headers: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBytes = encoder.encode(name);
    const valueBytes = encoder.encode(value);
    const header = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length);
    header[0] = nameBytes.length;
    header.set(nameBytes, 1);
    header[1 + nameBytes.length] = HEADER_TYPE_STRING;
    writeUint16BE(header, 1 + nameBytes.length + 1, valueBytes.length);
    header.set(valueBytes, 1 + nameBytes.length + 1 + 2);
    parts.push(header);
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Test helper: encode one Event Stream message (string headers + payload). */
export function encodeEventStreamMessage(
  headers: Record<string, string>,
  payload: Uint8Array,
): Uint8Array {
  const headerBytes = encodeStringHeaders(headers);
  const totalLength = PRELUDE_LENGTH + headerBytes.length + payload.length + MESSAGE_CRC_LENGTH;
  const message = new Uint8Array(totalLength);
  writeUint32BE(message, 0, totalLength);
  writeUint32BE(message, 4, headerBytes.length);
  writeUint32BE(message, 8, crc32(message.subarray(0, 8)));
  message.set(headerBytes, PRELUDE_LENGTH);
  message.set(payload, PRELUDE_LENGTH + headerBytes.length);
  writeUint32BE(
    message,
    totalLength - MESSAGE_CRC_LENGTH,
    crc32(message.subarray(0, totalLength - MESSAGE_CRC_LENGTH)),
  );
  return message;
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
