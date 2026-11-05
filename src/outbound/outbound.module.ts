import { Global, Module } from '@nestjs/common';
import { FetchHttpTransport } from './fetch-http-transport';
import { HTTP_TRANSPORT } from './http-transport';
import { HOST_RESOLVER } from './host-resolver';
import { SafeFetchService } from './safe-fetch.service';
import { SystemHostResolver } from './system-host-resolver';

@Global()
@Module({
  providers: [
    SystemHostResolver,
    FetchHttpTransport,
    { provide: HOST_RESOLVER, useExisting: SystemHostResolver },
    { provide: HTTP_TRANSPORT, useExisting: FetchHttpTransport },
    SafeFetchService,
  ],
  exports: [HOST_RESOLVER, HTTP_TRANSPORT, SafeFetchService],
})
export class OutboundModule {}
