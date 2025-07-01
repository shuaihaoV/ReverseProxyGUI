"use client";

import { 
  Server, 
  Plus, 
  Play, 
  Square, 
  Trash2, 
  Shield,
  ShieldOff,
  RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ProxyAPI } from "@/lib/proxy-api";
import type { ProxyConfig } from "@/types/proxy";

interface AppSidebarProps {
  configs: ProxyConfig[];
  selectedConfig: ProxyConfig | null;
  onConfigSelect: (config: ProxyConfig) => void;
  onAddNew: () => void;
  onRefresh: () => void;
}

export function AppSidebar({
  configs,
  selectedConfig,
  onConfigSelect,
  onAddNew,
  onRefresh,
}: AppSidebarProps) {

  const handleStartProxy = async (config: ProxyConfig, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await ProxyAPI.startProxy(config.id);
      toast.success(`代理 "${config.name}" 启动成功`);
      onRefresh();
    } catch (error) {
      console.error("启动代理失败:", error);
      toast.error(`启动代理失败: ${error}`);
    }
  };

  const handleStopProxy = async (config: ProxyConfig, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await ProxyAPI.stopProxy(config.id);
      toast.success(`代理 "${config.name}" 停止成功`);
      onRefresh();
    } catch (error) {
      console.error("停止代理失败:", error);
      toast.error(`停止代理失败: ${error}`);
    }
  };

  const handleDeleteProxy = async (config: ProxyConfig) => {
    try {
      await ProxyAPI.deleteConfig(config.id);
      toast.success(`代理 "${config.name}" 删除成功`);
      onRefresh();
    } catch (error) {
      console.error("删除代理失败:", error);
      toast.error(`删除代理失败: ${error}`);
    }
  };

  const getProtocolIcon = (config: ProxyConfig) => {
    const colorClass = config.is_running ? "text-green-600" : "text-gray-500";
    const Icon = config.use_https ? Shield : ShieldOff;
    return <Icon className={`w-4 h-4 ${colorClass}`} />;
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-4 py-2">
          <Server className="w-6 h-6" />
          <h1 className="text-lg font-semibold">反向代理</h1>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu>
          <div className="flex items-center justify-between px-3 py-2">
            <h2 className="text-base font-semibold">代理列表</h2>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={onAddNew}>
                <Plus className="w-4 h-4" />
                <span className="sr-only">新建代理</span>
              </Button>
              <Button variant="ghost" size="icon" onClick={onRefresh}>
                <RefreshCw className="w-4 h-4" />
                <span className="sr-only">刷新</span>
              </Button>
            </div>
          </div>
          {configs.map((config) => (
            <ContextMenu key={config.id}>
              <ContextMenuTrigger>
                <SidebarMenuItem
                  key={config.id}
                >
                  <SidebarMenuButton
                    onClick={() => onConfigSelect(config)}
                    isActive={selectedConfig?.id === config.id}
                    className="w-full"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {getProtocolIcon(config)}
                      <span className="truncate">{config.name}</span>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <span className="text-xs text-muted-foreground">
                        :{config.listen_port}
                      </span>
                    </div>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </ContextMenuTrigger>
              <ContextMenuContent>
                {config.is_running ? (
                  <ContextMenuItem
                    onClick={(e) => handleStopProxy(config, e)}
                  >
                    <Square className="w-4 h-4 mr-2" />
                    停止
                  </ContextMenuItem>
                ) : (
                  <ContextMenuItem
                    onClick={(e) => handleStartProxy(config, e)}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    启动
                  </ContextMenuItem>
                )}
                <ContextMenuItem
                  onClick={() => handleDeleteProxy(config)}
                  className="text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  删除
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </SidebarMenu>
      </SidebarContent>

    </Sidebar>
  );
}