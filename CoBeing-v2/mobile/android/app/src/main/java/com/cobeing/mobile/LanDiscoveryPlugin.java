package com.cobeing.mobile;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 局域网发现插件（方案 v2：自动配对）
 *
 * 手机 App 广播 scan 帧（cobeing-discover/1）到 255.255.255.255:7844，
 * 电脑内核的 DiscoveryService 应答 announce（单播回源端口），
 * 本插件收集应答返回可配对设备列表（名称/版本/WS 端口/LAN 地址）。
 *
 * 注意：Android 默认不接收 UDP 广播/组播，需 WifiManager.MulticastLock
 * （Manifest 需 ACCESS_WIFI_STATE + CHANGE_WIFI_MULTICAST_STATE）。
 */
@CapacitorPlugin(name = "LanDiscovery")
public class LanDiscoveryPlugin extends Plugin {

    private static final String SCAN_ADDR = "255.255.255.255";
    private static final int DEFAULT_SCAN_PORT = 7844;
    private static final int DEFAULT_TIMEOUT_MS = 4000;

    @PluginMethod
    public void scan(PluginCall call) {
        final int scanPort = call.getInt("scanPort", DEFAULT_SCAN_PORT);
        final int timeoutMs = call.getInt("timeoutMs", DEFAULT_TIMEOUT_MS);
        final String deviceName = call.getString("deviceName", "我的手机");

        // 网络操作必须在后台线程（插件方法在主线程调用）
        new Thread(() -> {
            WifiManager.MulticastLock lock = null;
            DatagramSocket socket = null;
            try {
                // 多播锁：Android 默认过滤广播帧，锁住 WiFi 才能收到广播
                try {
                    Context ctx = getContext();
                    WifiManager wifi = (WifiManager) ctx.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    if (wifi != null) {
                        lock = wifi.createMulticastLock("cobeing-lan-discovery");
                        lock.setReferenceCounted(false);
                        lock.acquire();
                    }
                } catch (Exception ignored) {
                    // 无权限/无 WiFi：仍尝试扫描（部分设备广播可达）
                }

                socket = new DatagramSocket();
                socket.setSoTimeout(timeoutMs);
                socket.setBroadcast(true);

                // 发送 scan 帧
                JSONObject scan = new JSONObject();
                scan.put("v", 1);
                scan.put("type", "scan");
                if (deviceName != null && !deviceName.isEmpty()) scan.put("deviceName", deviceName);
                byte[] payload = scan.toString().getBytes("UTF-8");
                InetAddress broadcast = InetAddress.getByName(SCAN_ADDR);
                socket.send(new DatagramPacket(payload, payload.length, broadcast, scanPort));

                // 收集应答（直到超时）
                List<JSObject> devices = new ArrayList<>();
                Set<String> seen = new HashSet<>();
                long deadline = System.currentTimeMillis() + timeoutMs;
                byte[] buf = new byte[2048];
                while (System.currentTimeMillis() < deadline) {
                    DatagramPacket packet = new DatagramPacket(buf, buf.length);
                    try {
                        socket.receive(packet);
                    } catch (java.net.SocketTimeoutException e) {
                        break; // 超时结束扫描
                    }
                    String line = new String(packet.getData(), 0, packet.getLength(), "UTF-8").trim();
                    JSONObject frame;
                    try {
                        frame = new JSONObject(line);
                    } catch (Exception e) {
                        continue; // 非本协议帧
                    }
                    if (frame.optInt("v", 0) != 1 || !"announce".equals(frame.optString("type"))) continue;
                    String id = frame.optString("id", "");
                    if (id.isEmpty() || !seen.add(id)) continue;
                    JSObject device = new JSObject();
                    device.put("id", id);
                    device.put("name", frame.optString("name", "电脑"));
                    device.put("version", frame.optString("version", ""));
                    device.put("host", frame.optString("host", ""));
                    device.put("wsPort", frame.optInt("wsPort", 0));
                    device.put("lanUrl", frame.optString("lanUrl", ""));
                    devices.add(device);
                }

                JSArray result = new JSArray();
                for (JSObject d : devices) result.put(d);
                JSObject ret = new JSObject();
                ret.put("devices", result);
                getActivity().runOnUiThread(() -> call.resolve(ret));
            } catch (Exception e) {
                getActivity().runOnUiThread(() -> call.reject("局域网扫描失败: " + e.getMessage()));
            } finally {
                if (socket != null) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {
                    }
                }
                if (lock != null && lock.isHeld()) {
                    try {
                        lock.release();
                    } catch (Exception ignored) {
                    }
                }
            }
        }).start();
    }
}
