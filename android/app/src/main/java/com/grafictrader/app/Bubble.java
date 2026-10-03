package com.grafictrader.app;

import android.content.Context;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Draggable floating bubble drawn over other apps (the user's broker). */
final class Bubble {
    private static final int COLOR_UP = 0xF015803D;
    private static final int COLOR_DOWN = 0xF0DC2626;
    private static final int COLOR_WAIT = 0xF01C1C1E;

    private final Context context;
    private final WindowManager windowManager;
    private final Runnable onOpenApp;
    private final Runnable onStop;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private LinearLayout root;
    private GradientDrawable background;
    private TextView badge;
    private TextView asset;
    private TextView detail;
    private TextView hint;
    private TextView stop;
    private WindowManager.LayoutParams params;
    private boolean expanded;
    private volatile Rect bounds;

    Bubble(Context context, Runnable onOpenApp, Runnable onStop) {
        this.context = context;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        this.onOpenApp = onOpenApp;
        this.onStop = onStop;
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, context.getResources().getDisplayMetrics()));
    }

    private TextView text(float sizeSp, boolean bold) {
        TextView view = new TextView(context);
        view.setTextColor(0xFFFFFFFF);
        view.setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp);
        if (bold) view.setTypeface(Typeface.DEFAULT_BOLD);
        return view;
    }

    @SuppressWarnings("deprecation")
    void show() {
        if (root != null) return;
        root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(10);
        root.setPadding(pad + dp(2), pad, pad + dp(2), pad);
        background = new GradientDrawable();
        background.setCornerRadius(dp(16));
        background.setColor(COLOR_WAIT);
        root.setBackground(background);

        badge = text(16, true);
        badge.setText("A ANALISAR…");
        asset = text(11, false);
        asset.setAlpha(0.85f);
        detail = text(13, false);
        detail.setMaxWidth(dp(250));
        detail.setVisibility(View.GONE);
        hint = text(10, false);
        hint.setAlpha(0.7f);
        hint.setText("Toque: esconder · Toque longo: abrir a app");
        hint.setVisibility(View.GONE);
        stop = text(13, true);
        stop.setText("✕  Parar análise");
        stop.setPadding(0, dp(8), 0, 0);
        stop.setVisibility(View.GONE);
        stop.setOnClickListener(v -> onStop.run());

        root.addView(badge);
        root.addView(asset);
        root.addView(detail);
        root.addView(hint);
        root.addView(stop);

        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(12);
        params.y = dp(140);
        root.setOnTouchListener(new DragListener());
        root.getViewTreeObserver().addOnGlobalLayoutListener(this::updateBounds);
        windowManager.addView(root, params);
    }

    /** Where the bubble is on screen, in real pixels, or null when it is not shown. */
    Rect bounds() {
        return bounds;
    }

    private void updateBounds() {
        if (root == null || root.getWidth() == 0) return;
        int[] location = new int[2];
        root.getLocationOnScreen(location);
        bounds = new Rect(location[0], location[1], location[0] + root.getWidth(), location[1] + root.getHeight());
    }

    void update(String label, String side, String assetText, String detailText) {
        if (root == null) return;
        badge.setText(label);
        background.setColor("up".equals(side) ? COLOR_UP : "down".equals(side) ? COLOR_DOWN : COLOR_WAIT);
        asset.setText(assetText == null ? "" : assetText);
        asset.setVisibility(assetText == null || assetText.isEmpty() ? View.GONE : View.VISIBLE);
        detail.setText(detailText == null ? "" : detailText);
    }

    void setHidden(boolean hidden) {
        if (root != null) root.setVisibility(hidden ? View.INVISIBLE : View.VISIBLE);
    }

    void remove() {
        if (root == null) return;
        try {
            windowManager.removeView(root);
        } catch (Exception ignored) {
            // already detached
        }
        root = null;
        bounds = null;
    }

    private void toggle() {
        expanded = !expanded;
        int visibility = expanded ? View.VISIBLE : View.GONE;
        detail.setVisibility(visibility);
        hint.setVisibility(visibility);
        stop.setVisibility(visibility);
    }

    private final class DragListener implements View.OnTouchListener {
        private float downX;
        private float downY;
        private int startX;
        private int startY;
        private boolean moved;
        private final Runnable longPress = () -> {
            moved = true;
            onOpenApp.run();
        };

        @Override
        public boolean onTouch(View view, MotionEvent event) {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = event.getRawX();
                    downY = event.getRawY();
                    startX = params.x;
                    startY = params.y;
                    moved = false;
                    handler.postDelayed(longPress, 650);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = event.getRawX() - downX;
                    float dy = event.getRawY() - downY;
                    if (Math.abs(dx) > dp(6) || Math.abs(dy) > dp(6)) {
                        moved = true;
                        handler.removeCallbacks(longPress);
                    }
                    if (moved && root != null) {
                        params.x = startX + Math.round(dx);
                        params.y = startY + Math.round(dy);
                        windowManager.updateViewLayout(root, params);
                        updateBounds();
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                    handler.removeCallbacks(longPress);
                    if (!moved) {
                        view.performClick();
                        toggle();
                    }
                    return true;
                case MotionEvent.ACTION_CANCEL:
                    handler.removeCallbacks(longPress);
                    return true;
                default:
                    return false;
            }
        }
    }
}
