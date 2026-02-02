import { WebSocketServer, WebSocket } from "ws";
import type { SyncStatusListener } from "../types.js";

const DEFAULT_PORT = 8765;

/**
 * Local WebSocket relay server for LAN sync
 * Desktop app hosts this, PWA connects to it
 */
export class LocalRelay {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private port: number;
  private onStatusChange?: SyncStatusListener;

  constructor(port = DEFAULT_PORT) {
    this.port = port;
  }

  /**
   * Start the relay server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port: this.port });

        this.wss.on("connection", (ws) => {
          console.log(`[Relay] Client connected`);
          this.clients.add(ws);

          ws.on("message", (data) => {
            // Broadcast to all other clients
            this.broadcast(data as Buffer, ws);
          });

          ws.on("close", () => {
            console.log(`[Relay] Client disconnected`);
            this.clients.delete(ws);
          });

          ws.on("error", (error) => {
            console.error(`[Relay] Client error:`, error);
            this.clients.delete(ws);
          });
        });

        this.wss.on("listening", () => {
          console.log(
            `[Relay] FREED sync relay running on ws://localhost:${this.port}`,
          );
          resolve();
        });

        this.wss.on("error", (error) => {
          console.error(`[Relay] Server error:`, error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Broadcast data to all connected clients except sender
   */
  private broadcast(data: Buffer, sender?: WebSocket): void {
    for (const client of this.clients) {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * Send data to all connected clients
   */
  send(data: Uint8Array): void {
    const buffer = Buffer.from(data);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(buffer);
      }
    }
  }

  /**
   * Stop the relay server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.wss) {
        for (const client of this.clients) {
          client.close();
        }
        this.clients.clear();
        this.wss.close(() => {
          console.log(`[Relay] Server stopped`);
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get the port the server is running on
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Set status change listener
   */
  onStatus(listener: SyncStatusListener): void {
    this.onStatusChange = listener;
  }
}
