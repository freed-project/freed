#!/usr/bin/env node

import net from "node:net";
import { pathToFileURL } from "node:url";

function parseStartPort(rawValue) {
  const port = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Start port must be an integer between 1 and 65535.");
  }

  return port;
}

function probePort(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (isInUse) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(isInUse);
    };

    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(100, () => finish(false));
  });
}

export async function isPortInUse(port) {
  const probes = ["127.0.0.1"];

  if (net.isIPv6("::1")) {
    probes.push("::1");
  }

  for (const host of probes) {
    if (await probePort(host, port)) {
      return true;
    }
  }

  return false;
}

export async function findFreePort(startPort, range = 200) {
  const parsedStartPort = parseStartPort(startPort);

  for (let port = parsedStartPort; port < parsedStartPort + range; port += 1) {
    if (!(await isPortInUse(port))) {
      return port;
    }
  }

  throw new Error("No free port found in the requested range.");
}

async function main() {
  try {
    const port = await findFreePort(process.argv[2]);
    console.log(port);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
