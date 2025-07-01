"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center max-w-md">
        <AlertTriangle className="w-16 h-16 text-red-500 mx-auto" />
        <h2 className="mt-4 text-2xl font-semibold">出错了</h2>
        <p className="mt-2 text-muted-foreground">
          {error.message || "应用程序遇到了一个意外错误"}
        </p>
        <div className="mt-6 space-x-4">
          <Button onClick={reset}>重试</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            刷新页面
          </Button>
        </div>
      </div>
    </div>
  );
}
