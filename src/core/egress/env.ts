// env — the proxy settings every program in the box needs (#130). Pure. A program that ignores them fails closed: the
// box's network has no route out. These are the variables only; the box seam passes them (BoxSpec.env, #112). The box's
// own Docker engine reads HTTP_PROXY and HTTPS_PROXY from its start environment, which the vm box sets (#113).
//
// localhost stays direct, because Testcontainers and the ITs talk to containers of the box's own dockerd there.

const LOCAL = ["localhost", "127.0.0.1", "::1"];

export type ProxyAddress = { readonly host: string; readonly port: number };

export function proxyEnv(proxy: ProxyAddress): Readonly<Record<string, string>> {
  const url = `http://${proxy.host}:${proxy.port}`;
  const noProxy = LOCAL.join(",");
  const jvm = [
    `-Dhttp.proxyHost=${proxy.host}`,
    `-Dhttp.proxyPort=${proxy.port}`,
    `-Dhttps.proxyHost=${proxy.host}`,
    `-Dhttps.proxyPort=${proxy.port}`,
    "-Dhttp.nonProxyHosts=localhost|127.*|[::1]",
  ];
  return {
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    // every JVM reads it, so Maven, Gradle and its daemon all go through the proxy
    JAVA_TOOL_OPTIONS: jvm.join(" "),
  };
}
