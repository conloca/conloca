/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- the channel carries content values of any shape; the methods on either side give them their types. */
import { APIClientError, ErrorCodes, StaleWriteError } from '@conloca/content-api-client';
import { ContentWriteRefusedError } from '../write-access.js';
import {
  type Call,
  type ControlMessage,
  type FrameEvent,
  type Result,
  type RpcErrorCode,
  readControlMessage,
  type WireError,
} from './protocol.js';

/** The part of a `MessagePort` the channel uses, so tests can hand it a fake. */
export type FramePort = Pick<
  MessagePort,
  'postMessage' | 'addEventListener' | 'removeEventListener' | 'start' | 'close'
>;

/** An error the channel itself raises, such as a call the other side does not answer. */
export class RpcError extends Error {
  readonly code: RpcErrorCode;

  constructor(message: string, code: RpcErrorCode) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
  }
}

/** Turns anything thrown into a cloneable description the other side rebuilds with {@link decodeWireError}. */
export function encodeWireError(error: unknown): WireError {
  if (error instanceof ContentWriteRefusedError) {
    return {
      name: error.name,
      message: error.message,
      method: error.method,
      refusal: { reason: error.refusal.reason },
    };
  }
  if (error instanceof StaleWriteError) {
    return { name: error.name, message: error.message, code: error.code, details: error.details, data: error.data };
  }
  if (error instanceof APIClientError) {
    return { name: error.name, message: error.message, code: error.code, details: error.details };
  }
  if (error instanceof RpcError) return { name: error.name, message: error.message, code: error.code };
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}

const ERROR_CODES: ReadonlySet<string> = new Set(Object.values(ErrorCodes));

function isErrorCode(code: string | undefined): code is APIClientError['code'] {
  return code !== undefined && ERROR_CODES.has(code);
}

function isRpcErrorCode(code: string | undefined): code is RpcErrorCode {
  return code === 'method_not_allowed' || code === 'bad_arguments' || code === 'rate_limited';
}

/** Rebuilds the error class {@link encodeWireError} described, so `instanceof` checks keep working. */
export function decodeWireError(wire: WireError): Error {
  const { message } = wire;
  // A code this side does not know still rebuilds the class; it only loses the code.
  const code = isErrorCode(wire.code) ? wire.code : ErrorCodes.INTERNAL_ERROR;
  switch (wire.name) {
    case 'ContentWriteRefusedError':
      return new ContentWriteRefusedError(wire.method ?? '', { reason: wire.refusal?.reason ?? message });
    case 'StaleWriteError': {
      const { data } = wire;
      const currentEtag =
        isPlainObject(data) && 'currentEtag' in data && typeof data.currentEtag === 'string'
          ? data.currentEtag
          : undefined;
      return new StaleWriteError({ code, message, currentEtag });
    }
    case 'APIClientError':
      return new APIClientError(message, code, wire.details);
    case 'RpcError':
      if (isRpcErrorCode(wire.code)) return new RpcError(message, wire.code);
      break;
    default:
      break;
  }
  const error = new Error(message);
  error.name = wire.name;
  return error;
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Reads a {@link WireError} that arrived on the port; `undefined` when `value` is not one. */
function readWireError(value: unknown): WireError | undefined {
  if (!isPlainObject(value) || !('name' in value) || !('message' in value)) return undefined;
  const { name, message } = value;
  if (typeof name !== 'string' || typeof message !== 'string') return undefined;
  const wire: WireError = { name, message };
  if ('code' in value && typeof value.code === 'string') wire.code = value.code;
  if ('details' in value) wire.details = value.details;
  if ('data' in value) wire.data = value.data;
  if ('method' in value && typeof value.method === 'string') wire.method = value.method;
  if ('refusal' in value && isPlainObject(value.refusal) && 'reason' in value.refusal) {
    const { reason } = value.refusal;
    if (typeof reason === 'string') wire.refusal = { reason };
  }
  return wire;
}

/* oxlint-disable no-underscore-dangle -- `__wireError` is the protocol's marker for an error inside a value. */

/**
 * Swaps every `Error` inside a value for `{ __wireError }`, walking only arrays and plain objects, so a Blob or File
 * travels untouched. Structured cloning would otherwise flatten the errors' classes.
 * shortcut: no cycle detection, values are content-API results; add a seen-set if a cyclic value ever crosses.
 */
export function encodeWireValue(value: unknown): unknown {
  if (value instanceof Error) {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- an encoded value is opaque on the wire; the receiving side decodes it.
    return { __wireError: encodeWireError(value) };
  }
  if (Array.isArray(value)) return value.map(encodeWireValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeWireValue(item)]));
  }
  return value;
}

/** Reverses {@link encodeWireValue}. */
export function decodeWireValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeWireValue);
  if (isPlainObject(value)) {
    const wire = '__wireError' in value ? readWireError(value.__wireError) : undefined;
    if (wire) return decodeWireError(wire);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeWireValue(item)]));
  }
  return value;
}

/* oxlint-enable no-underscore-dangle */

export interface FrameChannelHandlers {
  /** Answers a call from the other side; without it every call answers `method_not_allowed`. */
  call?(method: string, args: unknown[]): Promise<unknown>;
  event?(name: string, payload: unknown): void;
  control?(message: ControlMessage): void;
  /** Receives every message whose shape the channel does not recognise. */
  malformed?(data: unknown): void;
  /** Receives the error of an `emit` or `post` the port could not send; without it the error goes to `console.error`. */
  sendFailed?(error: unknown): void;
}

export interface FrameChannel {
  call(method: string, args?: unknown[]): Promise<unknown>;
  emit(name: string, payload?: unknown): void;
  post(message: ControlMessage): void;
  /** Stops listening and closes the port; calls still waiting for a result never settle. */
  close(): void;
}

/** Carries calls, results, events and control messages over one port between the editor frame and its parent. */
export function openFrameChannel(port: FramePort, handlers: FrameChannelHandlers): FrameChannel {
  let nextId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  async function answer(id: number, method: string, args: unknown[]): Promise<void> {
    let reply: Result;
    try {
      if (!handlers.call) throw new RpcError(`Method not allowed: ${method}`, 'method_not_allowed');
      reply = { kind: 'result', id, ok: true, value: encodeWireValue(await handlers.call(method, args)) };
    } catch (error) {
      reply = { kind: 'result', id, ok: false, error: encodeWireError(error) };
    }
    try {
      port.postMessage(reply);
    } catch (error) {
      // The value or error could not be cloned; the caller still needs an answer. A plain Error keeps the call error
      // codes to the protocol's own.
      const message = `Result of ${method} could not be sent: ${error instanceof Error ? error.message : String(error)}`;
      port.postMessage({ kind: 'result', id, ok: false, error: { name: 'Error', message } } satisfies Result);
    }
  }

  /** Handles `data` and returns whether it was a message the channel knows. */
  function receive(data: unknown): boolean {
    if (!isPlainObject(data) || !('kind' in data)) return false;
    const { kind } = data;
    const id = 'id' in data ? data.id : undefined;
    if (kind === 'call' && typeof id === 'number' && 'method' in data && 'args' in data) {
      const { method, args } = data;
      if (typeof method !== 'string' || !Array.isArray(args)) return false;
      void answer(id, method, args);
      return true;
    }
    if (kind === 'result' && typeof id === 'number' && 'ok' in data) {
      const error = data.ok === false && 'error' in data ? readWireError(data.error) : undefined;
      if (data.ok !== true && !error) return false;
      const entry = pending.get(id);
      pending.delete(id);
      if (error) entry?.reject(decodeWireError(error));
      else entry?.resolve(decodeWireValue('value' in data ? data.value : undefined));
      return true;
    }
    if (kind === 'event' && 'name' in data && typeof data.name === 'string') {
      handlers.event?.(data.name, 'payload' in data ? data.payload : undefined);
      return true;
    }
    const control = readControlMessage(data);
    if (control) handlers.control?.(control);
    return control !== undefined;
  }

  const listener = (event: MessageEvent) => {
    const { data } = event;
    if (!receive(data)) handlers.malformed?.(data);
  };
  port.addEventListener('message', listener);
  port.start();

  /** Sends a message nobody waits on, so a failure goes to `sendFailed` instead of the code that happened to send. */
  function send(message: FrameEvent | ControlMessage): void {
    try {
      port.postMessage(message);
    } catch (error) {
      if (handlers.sendFailed) handlers.sendFailed(error);
      else console.error('[conloca] frame message could not be sent', error);
    }
  }

  return {
    call(method, args = []) {
      const id = nextId++;
      const promise = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
      try {
        port.postMessage({ kind: 'call', id, method, args } satisfies Call);
      } catch (error) {
        pending.delete(id);
        return Promise.reject(error);
      }
      return promise;
    },
    emit(name, payload) {
      send({ kind: 'event', name, payload } satisfies FrameEvent);
    },
    post(message) {
      send(message);
    },
    close() {
      port.removeEventListener('message', listener);
      port.close();
      pending.clear();
    },
  };
}
