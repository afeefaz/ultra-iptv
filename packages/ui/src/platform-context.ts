import type { Platform } from '@ultra/platform';
import { createContext, useContext } from 'solid-js';

export const PlatformContext = createContext<Platform>();

export function usePlatform(): Platform {
  const platform = useContext(PlatformContext);
  if (!platform) throw new Error('PlatformContext missing');
  return platform;
}
