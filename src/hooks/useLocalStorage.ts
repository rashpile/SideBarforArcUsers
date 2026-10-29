import { useState, useCallback, useRef } from 'react';

type Parser<T> = (value: string) => T;
type Serializer<T> = (value: T) => string;

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options?: {
    parse?: Parser<T>;
    serialize?: Serializer<T>;
  }
): [T, (value: T) => void]
{
  const parse = options?.parse ?? ((v: string) => JSON.parse(v) as T);
  const serialize = options?.serialize ?? ((v: T) => JSON.stringify(v));
  // Callers pass serialize inline, so a ref keeps the setter stable across renders
  const serializeRef = useRef(serialize);
  serializeRef.current = serialize;

  const [value, setValue] = useState<T>(() =>
  {
    const saved = localStorage.getItem(key);
    if (saved === null) return initialValue;
    try
    {
      return parse(saved);
    }
    catch
    {
      return initialValue;
    }
  });

  const setStoredValue = useCallback((newValue: T) =>
  {
    setValue(newValue);
    localStorage.setItem(key, serializeRef.current(newValue));
  }, [key]);

  return [value, setStoredValue];
}
