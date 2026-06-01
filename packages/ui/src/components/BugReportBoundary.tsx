import { Component, type ErrorInfo, type ReactNode } from "react";
import type { RuntimeErrorSnapshot } from "@freed/shared";
import { recordRuntimeError } from "../lib/bug-report.js";
import { FatalErrorScreen } from "./FatalErrorScreen.js";

class InternalBugReportBoundary extends Component<{
  children: ReactNode;
}, {
  fatalError: RuntimeErrorSnapshot | { message: string } | null;
}> {
  state = { fatalError: null };

  static getDerivedStateFromError(error: Error) {
    return { fatalError: { message: error.message } };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const snapshot = recordRuntimeError({
      source: "react-boundary",
      error,
      fatal: true,
      componentStack: info.componentStack ?? undefined,
    });
    this.setState({ fatalError: snapshot });
  }

  render() {
    if (this.state.fatalError) {
      return (
        <FatalErrorScreen
          error={this.state.fatalError}
          productName="Freed Desktop"
          onRetry={() => window.location.reload()}
        />
      );
    }
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
