"use client";

import { useState, useEffect, useCallback } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { ProxyAPI } from "@/lib/proxy-api";
import type { ProxyConfig } from "@/types/proxy";

const formSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(50, "名称不能超过50个字符"),
  listen_port: z.coerce.number().min(1, "端口不能为空").max(65535, "端口号必须在1-65535之间"),
  listen_ip: z.enum(["127.0.0.1", "0.0.0.0"]),
  remote_address: z.string().url("无效的 URL").refine(
    (val) => {
      try {
        const url = new URL(val);
        return ["http:", "https:"].includes(url.protocol);
      } catch {
        return false;
      }
    },
    { message: "URL 必须以 http:// 或 https:// 开头" }
  ),
  remote_host: z.string().optional(),
  use_https: z.boolean(),
  headers: z.array(
    z.object({
      key: z.string().min(1, "请求头名称不能为空").regex(/^[A-Za-z0-9-]+$/, "请求头名称只能包含字母、数字和连字符"),
      value: z.string(),
    })
  ),
  rewrite_host_headers: z.boolean(),
  socks5_proxy: z.string().optional().refine(
    (val) => {
      if (!val || val.trim() === "") return true;
      try {
        const url = new URL(val);
        return url.protocol === "socks5:";
      } catch {
        return false;
      }
    },
    {
      message: "无效的 SOCKS5 URL。格式: socks5://[user:pass@]host:port",
    }
  ),
});

type ProxyFormData = z.infer<typeof formSchema>;

interface ProxyFormProps {
  config?: ProxyConfig | null;
  onSave: (config: ProxyConfig, wasRunning: boolean) => void;
  onCancel: () => void;
}

export function ProxyForm({ config, onSave, onCancel }: ProxyFormProps) {
  const [loading, setLoading] = useState(false);
  const [portAvailable, setPortAvailable] = useState<boolean | null>(null);
  const [checkingPort, setCheckingPort] = useState(false);

  const form = useForm<ProxyFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: config?.name || "",
      listen_port: config?.listen_port || 8080,
      listen_ip: (config?.listen_ip as "127.0.0.1" | "0.0.0.0") || "127.0.0.1",
      remote_address: config?.remote_address || "",
      remote_host: config?.remote_host || "",
      use_https: config?.use_https || false,
      headers: config?.headers || [],
      rewrite_host_headers: config?.rewrite_host_headers ?? true,
      socks5_proxy: config?.socks5_proxy || "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "headers",
  });

  const watchedPort = form.watch("listen_port");
  const watchedIp = form.watch("listen_ip");
  const watchedRemoteAddress = form.watch("remote_address");

  useEffect(() => {
    const checkPortAvailability = async () => {
      if (watchedPort > 0 && watchedPort <= 65535 && watchedIp) {
        setCheckingPort(true);
        // 如果正在编辑且端口/IP 没有更改，则该端口对该配置可用
        if (config && config.listen_port === watchedPort && config.listen_ip === watchedIp) {
          setPortAvailable(true);
          setCheckingPort(false);
          return;
        }
        try {
          const available = await ProxyAPI.checkPort(watchedIp, watchedPort);
          setPortAvailable(available);
        } catch (error) {
          console.error("检查端口失败:", error);
          setPortAvailable(false);
        } finally {
          setCheckingPort(false);
        }
      } else {
        setPortAvailable(null);
      }
    };

    const debounce = setTimeout(checkPortAvailability, 300);
    return () => clearTimeout(debounce);
  }, [watchedPort, watchedIp, config]);

  // 自动从远程地址提取主机名
  useEffect(() => {
    if (watchedRemoteAddress) {
      try {
        const url = new URL(watchedRemoteAddress);
        const currentRemoteHost = form.getValues("remote_host");
        if (!currentRemoteHost || currentRemoteHost === "") {
          form.setValue("remote_host", url.hostname, { shouldValidate: true });
        }
      } catch {
        // 忽略无效的 URL
      }
    }
  }, [watchedRemoteAddress, form]);

  const onSubmit = useCallback(async (values: ProxyFormData) => {
    // 验证端口可用性
    if (portAvailable === false) {
      toast.error("选定的端口不可用，请选择其他端口");
      return;
    }

    setLoading(true);
    try {
      const wasRunning = config?.is_running || false;

      // 构造完整的 ProxyConfig 对象
      const payload: ProxyConfig = {
        id: config?.id || `proxy_${Date.now()}`,
        created_at: config?.created_at || Date.now(),
        is_running: config?.is_running || false,
        ...values,
        headers: values.headers.filter(h => h.key.trim() !== ""),
        listen_address: `${values.use_https ? "https" : "http"}://${values.listen_ip}:${values.listen_port}`,
        remote_host: values.remote_host || new URL(values.remote_address).hostname,
        socks5_proxy: values.socks5_proxy?.trim() || undefined,
      };

      await ProxyAPI.saveConfig(payload);
      toast.success(`代理 "${payload.name}" 保存成功`);
      
      onSave(payload, wasRunning);
    } catch (error) {
      console.error("保存配置失败:", error);
      toast.error(`保存配置失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [config, onSave, portAvailable]);

  const handleAddHeader = useCallback(() => {
    append({ key: "", value: "" });
  }, [append]);

  const handleRemoveHeader = useCallback((index: number) => {
    remove(index);
  }, [remove]);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {config ? "编辑代理配置" : "创建新的代理配置"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>配置名称 <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="我的代理" 
                      {...field} 
                      maxLength={50}
                      aria-required="true"
                    />
                  </FormControl>
                  <FormDescription>
                    为该代理配置指定一个友好的名称（最多50个字符）
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4 items-start">
              <FormField
                control={form.control}
                name="listen_ip"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>监听 IP <span className="text-red-500">*</span></FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择监听 IP" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="127.0.0.1">localhost (127.0.0.1)</SelectItem>
                        <SelectItem value="0.0.0.0">Any (0.0.0.0)</SelectItem>
                      </SelectContent>
                    </Select>
                     <FormDescription>
                      127.0.0.1 仅本地可访问, 0.0.0.0 可被局域网访问
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="listen_port"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>监听端口 <span className="text-red-500">*</span></FormLabel>
                      {checkingPort && <span className="text-xs text-muted-foreground">检查中...</span>}
                      {!checkingPort && portAvailable === true && <span className="text-xs text-green-600">✓ 可用</span>}
                      {!checkingPort && portAvailable === false && <span className="text-xs text-red-600">✗ 已占用</span>}
                    </div>
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        max="65535"
                        placeholder="8080"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                        aria-required="true"
                        aria-invalid={portAvailable === false}
                      />
                    </FormControl>
                    <FormDescription>
                      端口号范围：1-65535
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="remote_address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>远程地址 <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input
                      placeholder="http://example.com"
                      {...field}
                      aria-required="true"
                    />
                  </FormControl>
                  <FormDescription>
                    目标服务器 URL (例如: http://example.com 或 https://api.example.com)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="remote_host"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>远程主机</FormLabel>
                  <FormControl>
                    <Input placeholder="example.com" {...field} />
                  </FormControl>
                  <FormDescription>
                    发送到远程服务器的 Host 请求头（留空将自动从远程地址提取）
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="socks5_proxy"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>SOCKS5 代理</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="socks5://user:pass@127.0.0.1:1080" 
                      {...field} 
                      value={field.value ?? ''} 
                    />
                  </FormControl>
                  <FormDescription>
                    为出站请求设置可选的 SOCKS5 代理。格式：socks5://[user:pass@]host:port
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="use_https"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">HTTPS 监听器</FormLabel>
                    <FormDescription>
                      为监听服务器启用 HTTPS (将自动生成自签名 SSL 证书)
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label="启用 HTTPS"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="rewrite_host_headers"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">重写 Host 请求头</FormLabel>
                    <FormDescription>
                      启用 Host、Referer 和 Origin 请求头的重写，使其与远程地址匹配
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      aria-label="重写 Host 请求头"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium">自定义请求头</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddHeader}
                  disabled={fields.length >= 20} // 限制最多20个自定义头
                >
                  添加请求头
                </Button>
              </div>
              {fields.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4 border rounded-md">
                  还没有自定义请求头，点击上方按钮添加
                </p>
              )}
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-center gap-2">
                  <FormField
                    control={form.control}
                    name={`headers.${index}.key`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input 
                            placeholder="X-Custom-Header" 
                            {...field} 
                            aria-label={`请求头名称 ${index + 1}`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`headers.${index}.value`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input 
                            placeholder="请求头值" 
                            {...field} 
                            aria-label={`请求头值 ${index + 1}`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveHeader(index)}
                    aria-label={`删除请求头 ${index + 1}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
              {fields.length >= 20 && (
                <p className="text-sm text-amber-600 text-center">
                  已达到最大自定义请求头数量（20个）
                </p>
              )}
            </div>

            <div className="flex justify-end space-x-4 pt-6">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={onCancel}
                disabled={loading}
              >
                取消
              </Button>
              <Button 
                type="submit" 
                disabled={loading || portAvailable === false || checkingPort}
              >
                {loading ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                    保存中...
                  </>
                ) : (
                  "保存配置"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
