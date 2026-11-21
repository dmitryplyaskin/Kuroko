import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { LlmError } from '../llm/llmErrors';

const privateAddresses = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) privateAddresses.addSubnet(network, bits, 'ipv4');
for (const [network, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
  privateAddresses.addSubnet(network, bits, 'ipv6');
}

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

function isPublicAddress(address: string, family: number) {
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (privateAddresses.check(address, type) || (family === 6 && !globalV6.check(address, type))) return false;
  return !Object.values(networkInterfaces()).flat().some((entry) => entry?.address === address);
}

export function createCustomApiFetch(privateOrigins: string | undefined) {
  const trusted = new Set((privateOrigins ?? '').split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => {
    const url = URL.parse(origin);
    return url && url.href === `${url.origin}/` && ['http:', 'https:'].includes(url.protocol) ? url.origin : undefined;
  }));

  return async (url: URL, options: RequestInit) => {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const family = isIP(hostname);
    const allowPrivate = trusted.has(url.origin);
    if (!allowPrivate && !family && !hostname.replace(/\.$/, '').includes('.')) throw new LlmError('custom_api_address_blocked');
    const addresses = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true });
    options.signal?.throwIfAborted();
    const target = addresses.find(({ address, family }) => allowPrivate || isPublicAddress(address, family));
    if (!target) throw new LlmError('custom_api_address_blocked');

    // Dial the checked address while keeping the original HTTP host and TLS identity.
    const pinned = new URL(url);
    pinned.hostname = target.family === 6 ? `[${target.address}]` : target.address;
    const headers = new Headers(options.headers);
    headers.set('Host', url.host);
    return fetch(pinned, {
      ...options, headers, redirect: 'error', proxy: false, tls: family ? undefined : { serverName: hostname },
    });
  };
}
