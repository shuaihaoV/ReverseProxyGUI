"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Toaster, toast } from "sonner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ProxyForm } from "@/components/proxy-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Globe,
  Shield,
  ShieldOff,
  Play,
  Square,
  Edit,
  Trash2,
  ArrowRight,
  Replace,
  Network
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { ProxyAPI } from "@/lib/proxy-api";
import type { ProxyConfig } from "@/types/proxy";

export default function HomePage() {
  const [configs, setConfigs] = useState<ProxyConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<ProxyConfig | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<ProxyConfig | null>(null);
  const [restartDialog, setRestartDialog] = useState<{ open: boolean; config?: ProxyConfig }>({ open: false });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshConfigs = useCallback(async (selectId?: string) => {
    try {
      setError(null);
      const data = await ProxyAPI.getAllConfigs();
      setConfigs(data);

      let newSelected: ProxyConfig | null = null;
      if (selectId) {
        newSelected = data.find(c => c.id === selectId) || null;
      } else if (selectedConfig) {
        // Keep selection if it still exists
        newSelected = data.find(c => c.id === selectedConfig.id) || null;
      }
      setSelectedConfig(newSelected);

    } catch (error) {
      console.error("加载配置失败:", error);
      setError("加载代理配置失败，请重试");
      toast.error("加载代理配置失败");
    } finally {
      setIsLoading(false);
    }
  }, [selectedConfig]);

  useEffect(() => {
    refreshConfigs();
  }, [refreshConfigs]); // 添加 refreshConfigs 依赖

  const handleConfigSelect = useCallback((config: ProxyConfig) => {
    setSelectedConfig(config);
    setShowForm(false);
    setEditingConfig(null);
  }, []);

  const handleAddNew = useCallback(() => {
    setShowForm(true);
    setEditingConfig(null);
    setSelectedConfig(null);
  }, []);

  const handleEdit = useCallback((config: ProxyConfig) => {
    setEditingConfig(config);
    setShowForm(true);
    setSelectedConfig(null);
  }, []);

  const handleSave = useCallback(async (savedConfig: ProxyConfig, wasRunning?: boolean) => {
    setShowForm(false);
    setEditingConfig(null);
    await refreshConfigs(savedConfig.id);

    if (wasRunning) {
      setRestartDialog({ open: true, config: savedConfig });
    }
  }, [refreshConfigs]);

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setEditingConfig(null);
  }, []);

  const handleStartProxy = useCallback(async (config: ProxyConfig) => {
    try {
      await ProxyAPI.startProxy(config.id);
      toast.success(`代理 "${config.name}" 启动成功`);
      await refreshConfigs(config.id);
    } catch (error) {
      console.error("启动代理失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`启动代理失败: ${errorMessage}`);
    }
  }, [refreshConfigs]);

  const handleStopProxy = useCallback(async (config: ProxyConfig) => {
    try {
      await ProxyAPI.stopProxy(config.id);
      toast.success(`代理 "${config.name}" 停止成功`);
      await refreshConfigs(config.id);
    } catch (error) {
      console.error("停止代理失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`停止代理失败: ${errorMessage}`);
    }
  }, [refreshConfigs]);

  const handleDeleteProxy = useCallback(async (config: ProxyConfig) => {
    if (!confirm(`确定要删除代理 "${config.name}" 吗？此操作不可恢复。`)) {
      return;
    }
    
    try {
      await ProxyAPI.deleteConfig(config.id);
      toast.success(`代理 "${config.name}" 删除成功`);
      setSelectedConfig(null);
      await refreshConfigs();
    } catch (error) {
      console.error("删除代理失败:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`删除代理失败: ${errorMessage}`);
    }
  }, [refreshConfigs]);

  const handleRestartProxy = useCallback(async () => {
    if (!restartDialog.config) return;

    const config = restartDialog.config;
    setRestartDialog({ open: false });

    try {
      toast.info(`正在重启代理 "${config.name}" ...`);
      await ProxyAPI.stopProxy(config.id);
      // 等待一段时间以确保代理完全停止
      await new Promise(resolve => setTimeout(resolve, 1000));
      await ProxyAPI.startProxy(config.id);
      toast.success(`代理 "${config.name}" 重启成功`);
      await refreshConfigs(config.id);
    } catch (error) {
      console.error("重启代理失败:", error);
      toast.error(`重启代理失败: ${error instanceof Error ? error.message : String(error)}`);
      await refreshConfigs(config.id);
    }
  }, [restartDialog.config, refreshConfigs]);

  const formatDate = useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  // Memoize sidebar props to prevent unnecessary re-renders
  const sidebarProps = useMemo(() => ({
    configs,
    selectedConfig,
    onConfigSelect: handleConfigSelect,
    onAddNew: handleAddNew,
    onRefresh: refreshConfigs,
  }), [configs, selectedConfig, handleConfigSelect, handleAddNew, refreshConfigs]);

  // 加载状态
  if (isLoading) {
    return (
      <SidebarProvider>
        <div className="flex h-screen w-full">
          <AppSidebar {...sidebarProps} />
          <SidebarInset className="flex-1 overflow-auto">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                <p className="mt-4 text-muted-foreground">加载中...</p>
              </div>
            </div>
          </SidebarInset>
        </div>
        <Toaster richColors />
      </SidebarProvider>
    );
  }

  // 错误状态
  if (error && configs.length === 0) {
    return (
      <SidebarProvider>
        <div className="flex h-screen w-full">
          <AppSidebar {...sidebarProps} />
          <SidebarInset className="flex-1 overflow-auto">
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Server className="w-16 h-16 text-red-500 mx-auto" />
                <h2 className="mt-4 text-xl font-semibold">加载失败</h2>
                <p className="mt-2 text-muted-foreground">{error}</p>
                <Button onClick={() => refreshConfigs()} className="mt-4">
                  重试
                </Button>
              </div>
            </div>
          </SidebarInset>
        </div>
        <Toaster richColors />
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <AppSidebar {...sidebarProps} />

        <SidebarInset className="flex-1 overflow-auto">
          <div className="p-6">
            {showForm ? (
              <ProxyForm
                config={editingConfig}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            ) : selectedConfig ? (
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Server className="w-8 h-8 text-primary" />
                    <div>
                      <h1 className="text-2xl font-bold">{selectedConfig.name}</h1>
                      <p className="text-sm text-muted-foreground">
                        创建于 {formatDate(selectedConfig.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedConfig.is_running ? (
                      <Button
                        onClick={() => handleStopProxy(selectedConfig)}
                        variant="outline"
                        size="sm"
                        className="text-red-500 border-red-500 hover:bg-red-500/10 hover:text-red-600"
                      >
                        <Square className="w-4 h-4 mr-2" />
                        停止
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleStartProxy(selectedConfig)}
                        variant="outline"
                        size="sm"
                        className="text-green-600 border-green-600 hover:bg-green-500/10 hover:text-green-700"
                      >
                        <Play className="w-4 h-4 mr-2" />
                        启动
                      </Button>
                    )}
                    <Button
                      onClick={() => handleEdit(selectedConfig)}
                      variant="outline"
                      size="sm"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      编辑
                    </Button>
                    <Button
                      onClick={() => handleDeleteProxy(selectedConfig)}
                      variant="destructive"
                      size="sm"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      删除
                    </Button>
                  </div>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle>配置详情</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">状态</span>
                      {selectedConfig.is_running ? (
                        <Badge variant="success">
                          <span className="relative flex h-2 w-2 mr-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                          </span>
                          运行中
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          <span className="relative flex h-2 w-2 mr-2">
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-gray-400"></span>
                          </span>
                          已停止
                        </Badge>
                      )}
                    </div>

                    <div className="grid md:grid-cols-[1fr_auto_1fr] items-center gap-4">
                      <div className="flex flex-col items-center text-center p-4 bg-muted rounded-lg">
                        <div className="flex items-center gap-2 font-semibold text-primary">
                          <Globe className="w-5 h-5" />
                          <span>监听地址</span>
                        </div>
                        <span className="font-mono text-muted-foreground break-all">{selectedConfig.listen_address}</span>
                      </div>
                      <ArrowRight className="w-6 h-6 text-muted-foreground hidden md:block" />
                      <div className="flex md:hidden items-center justify-center">
                        <ArrowRight className="w-6 h-6 text-muted-foreground rotate-90" />
                      </div>
                      <div className="flex flex-col items-center text-center p-4 bg-muted rounded-lg">
                        <div className="flex items-center gap-2 font-semibold text-primary">
                          <Server className="w-5 h-5" />
                          <span>转发目标</span>
                        </div>
                        <span className="font-mono text-muted-foreground break-all">{selectedConfig.remote_address}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">协议安全</span>
                      {selectedConfig.use_https ? (
                        <Badge variant="outline" className="border-green-500 text-green-600">
                          <Shield className="w-4 h-4 mr-2" />
                          HTTPS
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          <ShieldOff className="w-4 h-4 mr-2" />
                          HTTP
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">重写 Host 请求头</span>
                      {selectedConfig.rewrite_host_headers ? (
                        <Badge variant="outline" className="border-sky-500 text-sky-600">
                          <Replace className="w-4 h-4 mr-2" />
                          已启用
                        </Badge>
                      ) : (
                        <Badge variant="outline">
                          <Replace className="w-4 h-4 mr-2" />
                          已禁用
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">SOCKS5 代理</span>
                      {selectedConfig.socks5_proxy ? (
                        <div className="flex items-center gap-2 font-mono text-sm p-1 bg-muted rounded-md">
                          <Network className="w-4 h-4" />
                          <span>{selectedConfig.socks5_proxy}</span>
                        </div>
                      ) : (
                        <Badge variant="outline">
                          <Network className="w-4 h-4 mr-2" />
                          已禁用
                        </Badge>
                      )}
                    </div>

                    {selectedConfig.headers && selectedConfig.headers.length > 0 && (
                      <div className="space-y-2 pt-4">
                        <h4 className="font-medium text-muted-foreground">自定义请求头</h4>
                        <div className="p-4 border rounded-md bg-muted/50 space-y-2">
                          {selectedConfig.headers.map((header, index) => (
                            <div key={index} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
                              <span className="font-mono p-1 bg-background rounded-md text-center truncate">{header.key}</span>
                              <ArrowRight className="w-4 h-4 text-muted-foreground" />
                              <span className="font-mono p-1 bg-background rounded-md text-center truncate">{header.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Server className="w-16 h-16 text-muted-foreground" />
                <h2 className="mt-4 text-2xl font-semibold">欢迎使用反向代理管理器</h2>
                <p className="mt-2 text-muted-foreground max-w-md">
                  从侧边栏选择一个代理进行管理，或创建一个新的代理配置。
                </p>
                <Button onClick={handleAddNew} className="mt-6">
                  创建新代理
                </Button>
              </div>
            )}
          </div>
        </SidebarInset>
      </div>
      <Toaster richColors position="bottom-right" />

      <AlertDialog open={restartDialog.open} onOpenChange={(open) => setRestartDialog({ ...restartDialog, open })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>要重启代理吗？</AlertDialogTitle>
            <AlertDialogDescription>
              代理 &ldquo;{restartDialog.config?.name}&rdquo; 的配置已更新。您想现在重启代理以应用更改吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>稍后</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestartProxy}>立即重启</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </SidebarProvider>
  );
}
