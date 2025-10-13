declare module 'gradient-string' {
  type GradientCallable = ((text: string) => string) & {
    multiline: (text: string) => string;
  };

  interface GradientFactory {
    (...colors: string[]): GradientCallable;
    atlas: GradientCallable;
    retro: GradientCallable;
    pastel: GradientCallable;
    instagram: GradientCallable;
    teen: GradientCallable;
    mind: GradientCallable;
    morning: GradientCallable;
  }

  const gradient: GradientFactory;
  export default gradient;
}

declare module 'chalk-animation' {
  interface Animation {
    start(): void;
    stop(): void;
    frame(): void;
    replace(text: string): void;
  }

  interface ChalkAnimation {
    rainbow(text: string): Animation;
    neon(text: string): Animation;
    pulse(text: string): Animation;
    glitch(text: string): Animation;
    radar(text: string): Animation;
    karaoke(text: string): Animation;
  }

  const chalkAnimation: ChalkAnimation;
  export default chalkAnimation;
}

declare module 'opti-tools' {
  export function initializeSession(key: string): void;
}
