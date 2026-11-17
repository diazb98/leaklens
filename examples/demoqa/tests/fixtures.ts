// En tu proyecto: import { test as base, expect } from 'leaklens/playwright';
import { test as base, expect } from '../../../src/integrations/playwright';

/**
 * DemoQA carga decenas de anuncios y trackers: hacen las pruebas lentas e
 * inestables, y llenarían el reporte de LeakLens con tráfico de terceros.
 * Este fixture los bloquea antes de que salgan del navegador.
 */
const ADS = new RegExp(
  [
    'googlesyndication', 'doubleclick', 'googleadservices', 'adservice\\.google', 'google-analytics',
    'googletagmanager', 'googletagservices', 'pagead', 'amazon-adsystem', 'criteo', 'taboola',
    'outbrain', 'pubmatic', 'rubiconproject', 'adnxs', 'casalemedia', 'openx', 'ezoic', 'moatads',
    'scorecardresearch', 'quantserve', 'hotjar', 'facebook\\.net', 'yandex', 'sharethrough',
    'media\\.net', 'adthrive', 'id5-sync', '33across', 'gumgum', 'lijit', 'sovrn', 'smartadserver',
    'teads', 'adform', 'bidswitch', 'ad-delivery', 'fundingchoices', 'gstatic\\.com/ads', 'cdn-ad',
  ].join('|'),
  'i',
);

export const test = base.extend<{ blockAds: number }>({
  blockAds: [
    async ({ context }, use) => {
      let blocked = 0;
      await context.route(
        (url) => ADS.test(url.hostname) || ADS.test(url.pathname),
        (route) => {
          blocked++;
          return route.abort('blockedbyclient');
        },
      );
      await use(blocked);
    },
    { auto: true },
  ],
});

export { expect };
