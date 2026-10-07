declare module '@point-of-sale/receipt-printer-encoder' {
  export interface EncoderOptions {
    language?: 'esc-pos' | 'star-line' | 'star-prnt'
    columns?: number
    feedBeforeCut?: number
    [k: string]: unknown
  }
  export default class ReceiptPrinterEncoder {
    constructor(options?: EncoderOptions)
    initialize(): this
    codepage(value: string): this
    font(type: 'a' | 'b'): this
    bold(value?: boolean): this
    invert(value?: boolean): this
    size(width: number, height?: number): this
    text(value: string): this
    newline(n?: number): this
    raw(data: number[]): this
    barcode(value: string, symbology: string, options: number | { height?: number; width?: number; text?: boolean }): this
    qrcode(value: string, options?: { model?: number; size?: number; errorlevel?: 'l' | 'm' | 'q' | 'h' }): this
    cut(mode?: 'full' | 'partial'): this
    pulse(device?: number, on?: number, off?: number): this
    encode(): Uint8Array
  }
}

// Official QZ Tray client (no bundled types). Only the surface the bridge uses is declared.
declare module 'qz-tray' {
  type Cb = (...args: any[]) => void
  const qz: {
    api: { setPromiseType(fn: (resolver: (resolve: Cb, reject: Cb) => void) => Promise<unknown>): void }
    security: {
      setCertificatePromise(fn: (resolve: (v: string) => void, reject: Cb) => void): void
      setSignatureAlgorithm(alg: string): void
      setSignaturePromise(fn: (toSign: string) => (resolve: (v?: string) => void, reject: Cb) => void): void
    }
    websocket: {
      connect(opts?: { host?: string | string[]; retries?: number; delay?: number; keepAlive?: number; usingSecure?: boolean }): Promise<void>
      disconnect(): Promise<void>
      isActive(): boolean
      setClosedCallbacks(cb: Cb | Cb[]): void
      setErrorCallbacks(cb: Cb | Cb[]): void
      getNetworkInfo?: () => Promise<unknown>
    }
    printers: {
      find(query?: string): Promise<string | string[]>
      getDefault(): Promise<string>
      startListening(printers?: string | string[], options?: Record<string, unknown>): Promise<void>
      stopListening(): Promise<void>
      setPrinterCallbacks(cb: Cb | Cb[]): void
      getStatus?: () => Promise<void>
    }
    configs: { create(printer: string, opts?: Record<string, unknown>): unknown }
    print(config: unknown, data: unknown[]): Promise<void>
    version: string
  }
  export default qz
}

// Node-only WebSocket, used by the opt-in physical printer test.
declare module 'ws' {
  export const WebSocket: any
}
