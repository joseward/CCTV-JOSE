export class VideoRTC extends HTMLElement {
  video: HTMLVideoElement;
  mode: string;
  media: string;
  background: boolean;
  src: string;
  ondisconnect(): void;
  onmessage: Record<string, (msg: any) => void>;
}
