import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch, type RequestInit } from "undici";
import { UnsafeUrlError } from "./errors";
import { lookup } from "node:dns";

export class SafeHttpClient {
  blocklist: BlockList;

  constructor() {
    this.blocklist = new BlockList();

    for (const [net, prefix] of [
      ["0.0.0.0", 8], // "this" network
      ["10.0.0.0", 8], // private
      ["100.64.0.0", 10], // carrier-grade NAT
      ["127.0.0.0", 8], // loopback
      ["169.254.0.0", 16], // link-local, includes cloud metadata 169.254.169.254
      ["172.16.0.0", 12], // private
      ["192.0.0.0", 24], // IETF protocol assignments
      ["192.168.0.0", 16], // private
      ["198.18.0.0", 15], // benchmarking
      ["224.0.0.0", 4], // multicast
      ["240.0.0.0", 4], // reserved + broadcast
    ] as const) {
      this.blocklist.addSubnet(net, prefix, "ipv4");
    }

    this.blocklist.addAddress("::", "ipv6");
    this.blocklist.addAddress("::1", "ipv6");
    this.blocklist.addSubnet("fc00::", 7, "ipv6"); // unique local
    this.blocklist.addSubnet("fe80::", 10, "ipv6"); // link-local
    this.blocklist.addSubnet("ff00::", 8, "ipv6"); // multicast
    this.blocklist.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 can reach private IPv4 space
  }

  unmapIPv4 = (ip: string) => {
    const dotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // ::ffff:127.0.0.1
    if (dotted) {
      return dotted[1];
    }
    // ::ffff:7f00:1 (how the URL parser normalizes the same address)
    const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hex) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }

    return null;
  };

  isIpBlocked = (ip: string): boolean => {
    const v4 = this.unmapIPv4(ip);
    if (v4) {
      return this.isIpBlocked(v4);
    }

    const family = isIP(ip);
    if (family === 0) {
      // not a valid IP: refuse
      return true;
    }

    return this.blocklist.check(ip, family === 4 ? "ipv4" : "ipv6");
  };

  assertPublicUrl = (raw: string) => {
    let url: URL;

    try {
      url = new URL(raw);
    } catch {
      throw new UnsafeUrlError("Invalid URL", raw);
    }

    if (url.protocol !== "https:") {
      throw new UnsafeUrlError("URL must use https", raw);
    }
    if (url.username || url.password) {
      throw new UnsafeUrlError("URL must not contain credentials", raw);
    }

    // The URL parser already normalizes odd IP spellings (decimal, hex, short forms).
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      throw new UnsafeUrlError("URL points to a non-public host", raw);
    }

    if (isIP(host) && this.isIpBlocked(host)) {
      throw new UnsafeUrlError(
        "URL points to a private or reserved address",
        raw,
      );
    }

    return url;
  };

  guardedLookup: LookupFunction = (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        return callback(err, "", 0);
      }

      if (
        addresses.length === 0 ||
        addresses.some((a) => this.isIpBlocked(a.address))
      ) {
        const e: NodeJS.ErrnoException = new UnsafeUrlError(
          `${hostname} resolves to a private or reserved address`,
        );

        return callback(e, addresses, 0);
      }

      if (options.all) {
        return callback(null, addresses);
      }

      return callback(null, addresses[0].address, addresses[0].family);
    });
  };

  makeRequest = async (url: string, options: RequestInit) => {
    const agent = new Agent({
      keepAliveTimeout: 10000,
      connect: {
        lookup: this.guardedLookup,
        timeout: 10000,
      },
    });

    return fetch(url, {
      ...options,
      redirect: "manual",
      dispatcher: agent,
    });
  };
}
