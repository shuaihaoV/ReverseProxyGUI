import { invoke } from '@tauri-apps/api/core';
import type { ProxyConfig } from '@/types/proxy';

// 定义错误类型
export class ProxyAPIError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ProxyAPIError';
  }
}

// 添加超时包装函数
async function invokeWithTimeout<T>(
  command: string,
  args?: Record<string, unknown>,
  timeout = 10000
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new ProxyAPIError('请求超时', 'TIMEOUT')), timeout);
  });

  try {
    const result = await Promise.race([
      invoke<T>(command, args),
      timeoutPromise,
    ]);
    return result;
  } catch (error) {
    if (error instanceof ProxyAPIError) {
      throw error;
    }
    throw new ProxyAPIError(
      error instanceof Error ? error.message : String(error),
      'INVOKE_ERROR'
    );
  }
}

export const ProxyAPI = {
  async getAllConfigs(): Promise<ProxyConfig[]> {
    try {
      return await invokeWithTimeout<ProxyConfig[]>('get_all_configs');
    } catch (error) {
      console.error('Failed to get all configs:', error);
      throw new ProxyAPIError('获取配置列表失败', 'GET_ALL_CONFIGS_ERROR');
    }
  },

  async saveConfig(config: ProxyConfig): Promise<void> {
    try {
      // 验证配置
      if (!config.name || !config.name.trim()) {
        throw new ProxyAPIError('配置名称不能为空', 'VALIDATION_ERROR');
      }
      if (!config.remote_address) {
        throw new ProxyAPIError('远程地址不能为空', 'VALIDATION_ERROR');
      }
      
      await invokeWithTimeout<void>('save_config', { config });
    } catch (error) {
      if (error instanceof ProxyAPIError) {
        throw error;
      }
      console.error('Failed to save config:', error);
      throw new ProxyAPIError('保存配置失败', 'SAVE_CONFIG_ERROR');
    }
  },

  async deleteConfig(configId: string): Promise<void> {
    try {
      if (!configId) {
        throw new ProxyAPIError('配置 ID 不能为空', 'VALIDATION_ERROR');
      }
      
      await invokeWithTimeout<void>('delete_config', { configId });
    } catch (error) {
      console.error('Failed to delete config:', error);
      throw new ProxyAPIError('删除配置失败', 'DELETE_CONFIG_ERROR');
    }
  },

  async startProxy(configId: string): Promise<void> {
    try {
      if (!configId) {
        throw new ProxyAPIError('配置 ID 不能为空', 'VALIDATION_ERROR');
      }
      
      await invokeWithTimeout<void>('start_proxy', { configId }, 30000); // 30秒超时
    } catch (error) {
      console.error('Failed to start proxy:', error);
      if (error instanceof Error && error.message.includes('Port') && error.message.includes('in use')) {
        throw new ProxyAPIError('端口已被占用', 'PORT_IN_USE');
      }
      throw new ProxyAPIError('启动代理失败', 'START_PROXY_ERROR');
    }
  },

  async stopProxy(configId: string): Promise<void> {
    try {
      if (!configId) {
        throw new ProxyAPIError('配置 ID 不能为空', 'VALIDATION_ERROR');
      }
      
      await invokeWithTimeout<void>('stop_proxy', { configId });
    } catch (error) {
      console.error('Failed to stop proxy:', error);
      throw new ProxyAPIError('停止代理失败', 'STOP_PROXY_ERROR');
    }
  },

  async checkPort(ip: string, port: number): Promise<boolean> {
    try {
      if (!ip || port < 1 || port > 65535) {
        return false;
      }
      
      return await invokeWithTimeout<boolean>('check_port', { ip, port }, 5000);
    } catch (error) {
      console.error('Failed to check port:', error);
      // 出错时返回 false，假设端口不可用
      return false;
    }
  },

  async createDefaultConfig(): Promise<ProxyConfig> {
    try {
      return await invokeWithTimeout<ProxyConfig>('create_default_config');
    } catch (error) {
      console.error('Failed to create default config:', error);
      // 返回前端默认配置
      return {
        id: `proxy_${Date.now()}`,
        name: '新代理',
        listen_address: 'http://127.0.0.1:8080',
        listen_port: 8080,
        listen_ip: '127.0.0.1',
        remote_address: '',
        remote_host: '',
        use_https: false,
        headers: [],
        rewrite_host_headers: true,
        socks5_proxy: undefined,
        created_at: Date.now(),
        is_running: false,
      };
    }
  },
};
