/**
 * 自定义请求头结构体
 */
export interface Header {
  key: string;
  value: string;
}

/**
 * 代理配置接口
 */
export interface ProxyConfig {
  /** 唯一标识符 */
  id: string;
  /** 配置名称 */
  name: string;
  /** 监听地址（完整URL） */
  listen_address: string;
  /** 监听端口 */
  listen_port: number;
  /** 监听IP地址 */
  listen_ip: string;
  /** 远程目标地址 */
  remote_address: string;
  /** 远程主机名 */
  remote_host: string;
  /** 是否使用HTTPS */
  use_https: boolean;
  /** 自定义请求头 */
  headers: Header[];
  /** 是否重写Host请求头 */
  rewrite_host_headers: boolean;
  /** SOCKS5代理地址 */
  socks5_proxy?: string;
  /** 创建时间戳 */
  created_at: number;
  /** 是否正在运行 */
  is_running: boolean;
}

/**
 * 代理状态枚举
 */
export enum ProxyStatus {
  STOPPED = "stopped",
  RUNNING = "running",
  ERROR = "error",
}

/**
 * API 错误响应接口
 */
export interface ErrorResponse {
  error: string;
  code: string;
}
