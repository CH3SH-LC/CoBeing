package com.cobeing.mobile;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * APK 安装插件：把已下载到应用 cache 目录的 APK 通过 FileProvider + ACTION_VIEW
 * 交给系统安装器安装（Android 8+ 需用户在系统设置中允许本应用安装未知应用）。
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("缺少 path 参数（cache 目录下相对路径）");
            return;
        }
        // 防御：只允许 cache 目录内的文件（拒绝绝对路径与 ..）
        String clean = path.trim().replace('\\', '/');
        if (clean.startsWith("/") || clean.contains("..")) {
            call.reject("非法路径");
            return;
        }
        File cacheDir = getContext().getCacheDir();
        File apk = new File(cacheDir, clean);
        if (!apk.exists()) {
            call.reject("APK 文件不存在: " + clean);
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("installed", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("启动安装界面失败: " + e.getMessage());
        }
    }
}
