"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

export default class DropInErrorBoundary extends Component<
  { children: ReactNode; fallback: (error: Error) => ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Drop In v2 render failure", error, info); }
  render() { return this.state.error ? this.props.fallback(this.state.error) : this.props.children; }
}

