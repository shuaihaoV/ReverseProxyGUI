import { useState, useCallback, useEffect } from "react";
import { ProxyAPI } from "@/lib/proxy-api";
import type { ProxyConfig } from "@/types/proxy";

interface UseProxyStatusReturn {
  configs: ProxyConfig[];
  isLoading: boolean;
  error: string | null;
  refreshConfigs: (selectId?: string) => Promise<void>;
  startProxy: (configId: string) => Promise<void>;
  stopProxy: (configId: string) => Promise<void>;
  deleteConfig: (configId: string) => Promise<void>;
}

export function useProxyStatus(): UseProxyStatusReturn {
  const [configs, setConfigs] = useState<ProxyConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshConfigs = useCallback(async (selectId?: string) => {
    try {
      setError(null);
      const data = await ProxyAPI.getAllConfigs();
      setConfigs(data);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "未知错误";
      setError(errorMessage);
      console.error("Failed to refresh configs:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const startProxy = useCallback(async (configId: string) => {
    await ProxyAPI.startProxy(configId);
    await refreshConfigs();
  }, [refreshConfigs]);

  const stopProxy = useCallback(async (configId: string) => {
    await ProxyAPI.stopProxy(configId);
    await refreshConfigs();
  }, [refreshConfigs]);

  const deleteConfig = useCallback(async (configId: string) => {
    await ProxyAPI.deleteConfig(configId);
    await refreshConfigs();
  }, [refreshConfigs]);

  useEffect(() => {
    refreshConfigs();
  }, [refreshConfigs]);

  // 自动刷新状态（每30秒）
  useEffect(() => {
    const interval = setInterval(() => {
      refreshConfigs();
    }, 30000);

    return () => clearInterval(interval);
  }, [refreshConfigs]);

  return {
    configs,
    isLoading,
    error,
    refreshConfigs,
    startProxy,
    stopProxy,
    deleteConfig,
  };
}
