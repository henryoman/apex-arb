import gradient from 'gradient-string';
import chalkAnimation from 'chalk-animation';
import { sleep } from './utils.js';

const BANNER = String.raw`
 █████╗ ██████╗ ███████╗██╗  ██╗     █████╗ ██████╗ ██████╗ 
██╔══██╗██╔══██╗██╔════╝╚██╗██╔╝    ██╔══██╗██╔══██╗██╔══██╗
███████║██████╔╝█████╗   ╚███╔╝     ███████║██████╔╝██████╔╝
██╔══██║██╔═══╝ ██╔══╝   ██╔██╗     ██╔══██║██╔══██╗██╔══██╗
██║  ██║██║     ███████╗██╔╝ ██╗    ██║  ██║██║  ██║██████╔╝
╚═╝  ╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ 
                S O L A N A  ARBITRAGE  v 2.1
                     github.com/apexarb
`;

export async function printBanner(): Promise<void> {
  console.log(gradient('#ffa65dff', '#8c78ffff', '#75ffaeff').multiline(BANNER));
  const animation = chalkAnimation.rainbow('ApexArb Launching…');
  await sleep(1200);
  animation.stop();
  process.stdout.write('\x1B[2K\r');
}
