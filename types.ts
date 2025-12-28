
export interface Snapshot {
  id: string;
  url: string;
  timestamp: Date;
  processedUrl?: string;
  threshold: number;
}

export enum AppStatus {
  IDLE = 'IDLE',
  CAPTURING = 'CAPTURING',
  ERROR = 'ERROR'
}
