import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordRuntimeError } from "../lib/bug-report.js";

class InternalBugReportBoundary extends Component<{
  children: ReactNode;
}> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordRuntimeError({
      source: "react-boundary",
      error,
      fatal: true,
      componentStack: info.componentStack ?? undefined,
    });
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function BugReportBoundary({
  children,
}: {
  children: ReactNode;
}) {
  return <InternalBugReportBoundary>{children}</InternalBugReportBoundary>;
}
