import axios, {
  type AxiosRequestConfig,
  type AxiosInstance,
  type AxiosResponse,
  type AxiosError,
} from "axios";

abstract class HttpClient {
  public readonly instance: AxiosInstance;
  public readonly instanceWithoutAuth: AxiosInstance;

  constructor(option: AxiosRequestConfig) {
    this.instance = axios.create(option);
    this.instanceWithoutAuth = axios.create({ baseURL: option.baseURL });
    this.initializeResponseInterceptor();
  }

  private initializeResponseInterceptor = () => {
    this.instance.interceptors.response.use(
      this.handleResponse.bind(this) as any,
      this.handleError.bind(this),
    );
  };

  protected abstract handleError<T>(error: AxiosError<T>): unknown;
  protected abstract handleResponse<T>(response: AxiosResponse<T>): unknown;
}

export class Http extends HttpClient {
  constructor(baseURL: string, baseHeaders?: Record<string, string>) {
    super({
      baseURL,
      headers: baseHeaders
        ? baseHeaders
        : { "Content-Type": "application/json", Accept: "application/json" },
    });
  }

  protected handleResponse = <T>(response: AxiosResponse<T>) => {
    return {
      is_ok: true,
      data: response.data,
      headers: response.headers,
      status_code: response.status,
    };
  };

  protected handleError = <T>(error: AxiosError<T>) => {
    return {
      is_ok: false,
      data: error.response?.data,
      headers: error.response?.headers,
      status_code: error.response?.status,
    };
  };

  get = async <TData = unknown>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<TData>> => {
    return this.instance.get(url, config);
  };

  post = async <TData = unknown>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<TData>> => {
    return this.instance.post(url, data, config);
  };

  put = async <TData = unknown>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<TData>> => {
    return this.instance.put(url, data, config);
  };

  patch = async <TData = unknown>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<TData>> => {
    return this.instance.patch(url, data, config);
  };

  delete = async <TData = unknown>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<HttpResponse<TData>> => {
    return this.instance.delete(url, config);
  };
}
