import type { DeviceType } from './device-id';

/** Model suggestions for the booking wizard (free text is always allowed). Newest first. */
export const MODEL_SUGGESTIONS: Partial<Record<DeviceType, string[]>> = {
  iphone: [
    'iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone Air', 'iPhone 17',
    'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16', 'iPhone 16e',
    'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
    'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14',
    'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 13 mini',
    'iPhone 12 Pro Max', 'iPhone 12 Pro', 'iPhone 12', 'iPhone 12 mini',
    'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11', 'iPhone SE (3rd generation)', 'iPhone XR', 'iPhone XS Max', 'iPhone X',
  ],
  macbook: [
    'MacBook Pro 16" (M4)', 'MacBook Pro 14" (M4)', 'MacBook Air 15" (M4)', 'MacBook Air 13" (M4)',
    'MacBook Pro 16" (M3)', 'MacBook Pro 14" (M3)', 'MacBook Air 15" (M3)', 'MacBook Air 13" (M3)',
    'MacBook Pro 16" (M2)', 'MacBook Pro 14" (M2)', 'MacBook Air 15" (M2)', 'MacBook Air 13" (M2)',
    'MacBook Pro 16" (M1)', 'MacBook Pro 14" (M1)', 'MacBook Pro 13" (M1)', 'MacBook Air (M1, 2020)',
    'MacBook Pro 16" (Intel, 2019)', 'MacBook Pro 13" (Intel)', 'MacBook Air (Intel)',
  ],
  ipad: [
    'iPad Pro 13" (M4)', 'iPad Pro 11" (M4)', 'iPad Air 13" (M2/M3)', 'iPad Air 11" (M2/M3)',
    'iPad (A16)', 'iPad (10th generation)', 'iPad (9th generation)', 'iPad mini (A17 Pro)', 'iPad mini (6th generation)',
    'iPad Pro 12.9" (older)', 'iPad Pro 11" (older)', 'iPad Air (5th generation)',
  ],
  imac: ['iMac 24" (M4)', 'iMac 24" (M3)', 'iMac 24" (M1)', 'iMac 27" (Intel, 2020)', 'iMac 27" (Intel, 2017-2019)', 'iMac 21.5" (Intel)', 'iMac Pro'],
};

/** Where to find the identifier for each device type (shown under the IMEI/serial field). */
export const IDENTIFIER_HELP: Partial<Record<DeviceType, string>> = {
  iphone: 'Dial *#06# or open Settings › General › About. The IMEI has 15 digits.',
  ipad: 'Settings › General › About. Cellular iPads also show an IMEI.',
  macbook: 'Apple menu › About This Mac, or the underside of the case.',
  imac: 'Apple menu › About This Mac, or the underside of the stand.',
};
