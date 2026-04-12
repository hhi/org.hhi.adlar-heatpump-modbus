/* eslint-disable import/prefer-default-export */
/* eslint-disable import/no-unresolved */
/* eslint-disable node/no-missing-import */
/* eslint-disable import/extensions */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { DataSnapshot } from '../modbus/adlar2-modbus-service';

export interface DashboardServiceOptions {
  /** __dirname van app.ts — basis voor het pad naar public/dashboard.html */
  appDir: string;
  logger: (msg: string, ...args: unknown[]) => void;
  /** default 8090 */
  port?: number;
}

/**
 * ADR-041a: Lokale HTTP-server die een register-overzicht dashboard serveert.
 *
 * Routes:
 *   GET /               → public/dashboard.html
 *   GET /dashboard.html → public/dashboard.html
 *   GET /api/snapshot   → laatste DataSnapshot als JSON, of 204 als nog geen data
 *   *                   → 404
 */
export class DashboardService {
  private snapshot: DataSnapshot | null = null;
  private server: http.Server | null = null;
  private readonly port: number;
  private readonly publicDir: string;
  private readonly logger: (msg: string, ...args: unknown[]) => void;

  constructor(options: DashboardServiceOptions) {
    this.port = options.port ?? 8090;
    this.publicDir = path.join(options.appDir, 'public');
    this.logger = options.logger;
  }

  /** Sla de meest recente snapshot op (overschrijft de vorige). */
  setSnapshot(snapshot: DataSnapshot): void {
    this.snapshot = snapshot;
  }

  /** Start de HTTP-server. */
  start(): void {
    this.server = http.createServer((req, res) => {
      this._handleRequest(req, res);
    });

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        this.logger(`DashboardService: Poort ${this.port} is al in gebruik — dashboard niet beschikbaar`);
      } else {
        this.logger('DashboardService: Server fout:', err.message);
      }
    });

    this.server.listen(this.port, () => {
      this.logger(`DashboardService: Gestart op http://localhost:${this.port}/`);
    });
  }

  /** Sluit de server en ruimt resources op. */
  destroy(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        this.logger('DashboardService: Gestopt');
        resolve();
      });
    });
  }

  private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/';

    if (url === '/' || url === '/dashboard.html') {
      this._serveDashboard(res);
      return;
    }

    if (url === '/api/snapshot') {
      this._serveSnapshot(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private _serveDashboard(res: http.ServerResponse): void {
    const filePath = path.join(this.publicDir, 'dashboard.html');
    fs.readFile(filePath, (err, content) => {
      if (err) {
        this.logger('DashboardService: Fout bij laden dashboard.html:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading dashboard');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    });
  }

  private _serveSnapshot(res: http.ServerResponse): void {
    if (!this.snapshot) {
      res.writeHead(204);
      res.end();
      return;
    }
    const json = JSON.stringify(this.snapshot);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(json);
  }
}
