export type OutboundRequest = {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
  pinAddresses?: string[];
};

export type OutboundResponse = {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
};

export const HTTP_TRANSPORT = Symbol('HTTP_TRANSPORT');

export interface HttpTransport {
  request(request: OutboundRequest): Promise<OutboundResponse>;
}
