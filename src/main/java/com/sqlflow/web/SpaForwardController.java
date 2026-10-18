package com.sqlflow.web;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 前后端不分离 + 前端是 SPA（React Router）：直接打开或刷新 /workflows/1 这类地址时，
 * 后端要把入口页交给前端，让路由接管。
 *
 * <p><b>为什么直接返回 index.html 内容、而不是 {@code forward:/index.html}：</b>
 * forward 会走静态资源处理器，响应带 {@code Last-Modified}，浏览器就会做启发式缓存；
 * 而 {@code vite build} 是 {@code emptyOutDir} —— 旧 index.html 一被缓存、它引用的旧 js 又被删掉，
 * 刷新就变成白屏（去请求一个 404 的 js）。这里明确 {@code no-store}，入口永远拿最新的。
 * （带 hash 的 {@code /assets/*.js} 仍然走静态资源，可以放心长期缓存。）</p>
 *
 * <p>只列前端实际用到的路由（见 {@code frontend/src/App.tsx}）——**新增页面路由时记得加进来**。</p>
 */
@Controller
public class SpaForwardController {

    private static final Resource INDEX = new ClassPathResource("static/index.html");

    @GetMapping({"/", "/workflows", "/workflows/**", "/datasources", "/datasources/**",
            "/apis", "/apis/**", "/api-tokens", "/api-tokens/**"})
    public ResponseEntity<Resource> index() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.TEXT_HTML)
                .body(INDEX);
    }
}
