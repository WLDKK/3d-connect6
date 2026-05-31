import { useSyncExternalStore, useCallback } from "react";

export interface ViewState {
  transparencyEnabled: boolean;
  sliceEnabled: boolean;
  sliceAxis: "x" | "y" | "z";
  sliceIndex: number;
  theme: "dark" | "light";
}

const initialState: ViewState = {
  transparencyEnabled: true,
  sliceEnabled: false,
  sliceAxis: "z",
  sliceIndex: 0,
  theme: "dark",
};

let state: ViewState = { ...initialState };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return state;
}

function setState(partial: Partial<ViewState>) {
  state = { ...state, ...partial };
  emit();
}

export function useViewState(): ViewState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useViewActions() {
  const toggleTransparency = useCallback(() => {
    setState({ transparencyEnabled: !state.transparencyEnabled });
  }, []);

  const toggleSliceEnabled = useCallback(() => {
    setState({ sliceEnabled: !state.sliceEnabled });
  }, []);

  const setSliceAxis = useCallback((axis: "x" | "y" | "z") => {
    setState({ sliceAxis: axis });
  }, []);

  const setSliceIndex = useCallback((idx: number) => {
    setState({ sliceIndex: idx });
  }, []);

  const toggleTheme = useCallback(() => {
    setState({ theme: state.theme === "dark" ? "light" : "dark" });
  }, []);

  return { toggleTransparency, toggleSliceEnabled, setSliceAxis, setSliceIndex, toggleTheme };
}
