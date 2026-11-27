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
    private final Runnable onOpenLive;
    private final Runnable onStop;
    private final Runnable onMessages;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private LinearLayout root;
    private GradientDrawable background;
    private TextView badge;
    private TextView notice;
    private TextView asset;
    private TextView detail;
    private TextView hint;
    private TextView stop;
    private LinearLayout shortcuts;
    private TextView liveShortcut;
    private TextView chatShortcut;
    private TextView liveStatus;
    private TextView liveTranscript;
    private boolean liveMode;
    private WindowManager.LayoutParams params;
    private boolean expanded;
    private volatile Rect bounds;

    Bubble(Context context, Runnable onOpenApp, Runnable onOpenLive, Runnable onMessages, Runnable onStop) {
        this.context = context;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        this.onOpenApp = onOpenApp;
        this.onOpenLive = onOpenLive;
        this.onMessages = onMessages;
        this.onStop = onStop;
    }

    private int dp(float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, context.getResources().getDisplayMetrics()));
    }

    private TextView shortcut(String label) {
        TextView view = text(11, true);
        view.setText(label);
        view.setGravity(Gravity.CENTER);
        view.setMaxLines(1);
        view.setPadding(dp(5), 0, dp(5), 0);
        GradientDrawable chip = new GradientDrawable();
        chip.setColor(0xFF30343B);
        chip.setCornerRadius(dp(10));
        chip.setStroke(dp(1), 0xFF626873);
        view.setBackground(chip);
        view.setClickable(true);
        view.setFocusable(true);
        return view;
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
        badge.setMaxWidth(dp(250));
        notice = text(12, false);
        notice.setTextColor(0xFFFFE08A);
        notice.setMaxWidth(dp(250));
        notice.setVisibility(View.GONE);
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

        shortcuts = new LinearLayout(context);
        shortcuts.setOrientation(LinearLayout.HORIZONTAL);
        shortcuts.setGravity(Gravity.CENTER_VERTICAL);
        shortcuts.setPadding(0, dp(8), 0, 0);
        liveShortcut = shortcut("🎙  LIVE");
        chatShortcut = shortcut("✉  Mensagens");
        liveShortcut.setOnClickListener(v -> onOpenLive.run());
        chatShortcut.setOnClickListener(v -> { onMessages.run(); showResponse(); });
        LinearLayout.LayoutParams shortcutParams = new LinearLayout.LayoutParams(0, dp(36), 1f);
        shortcutParams.setMargins(0, 0, dp(6), 0);
        shortcuts.addView(liveShortcut, shortcutParams);
        LinearLayout.LayoutParams chatParams = new LinearLayout.LayoutParams(0, dp(36), 1f);
        shortcuts.addView(chatShortcut, chatParams);
        shortcuts.setVisibility(View.GONE);

        root.addView(badge);
        root.addView(notice);
        root.addView(asset);
        root.addView(detail);
        root.addView(hint);
        // Give the weighted shortcut buttons a real width. With WRAP_CONTENT,
        // the horizontal row can measure to zero and remain invisible on Android.
        root.addView(shortcuts, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
        liveStatus = text(12, true);
        liveStatus.setText("LIVE · pronto para ouvir");
        liveStatus.setVisibility(View.GONE);
        liveTranscript = text(13, false);
        liveTranscript.setText("Toca em LIVE para começar a conversar.");
        liveTranscript.setMaxWidth(dp(270));
        liveTranscript.setMaxLines(5);
        liveTranscript.setVisibility(View.GONE);
        root.addView(liveStatus);
        root.addView(liveTranscript);
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

    /** A short line under the label: why nothing new is shown (no AI quota, minutes left…). Null hides it. */
    void notice(String text) {
        if (root == null) return;
        notice.setText(text == null ? "" : text);
        notice.setVisibility(text == null || text.isEmpty() ? View.GONE : View.VISIBLE);
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

    void showLiveMode(boolean active) {
        // Leaving LIVE must restore the existing normal bubble, not leave it
        // stuck in the voice layout with a paused microphone.
        if (!active) {
            showResponse();
            return;
        }
        liveMode = true;
        expanded = true;
        detail.setVisibility(View.GONE);
        hint.setVisibility(View.GONE);
        stop.setVisibility(View.GONE);
        liveStatus.setVisibility(View.VISIBLE);
        liveTranscript.setVisibility(View.VISIBLE);
        shortcuts.setVisibility(View.VISIBLE);
        liveShortcut.setText(active ? "■  Parar LIVE" : "🎙  Retomar LIVE");
        chatShortcut.setText("✉  Mensagens");
        liveStatus.setText(active ? "LIVE · a ouvir" : "LIVE pausado");
        root.requestLayout();
    }

    void updateLive(String status, String transcript) {
        if (root == null) return;
        if (liveStatus != null && status != null) liveStatus.setText(status);
        if (status != null && liveShortcut != null) {
            if (status.contains("a responder")) liveShortcut.setText("↪  Interromper");
            else if (status.contains("a ouvir") || status.contains("a pensar")) liveShortcut.setText("■  Parar LIVE");
            else if (status.contains("pausado")) liveShortcut.setText("🎙  Retomar LIVE");
        }
        if (liveTranscript != null && transcript != null) liveTranscript.setText(transcript);
        root.requestLayout();
    }

    private void showResponse() {
        liveMode = false;
        liveStatus.setVisibility(View.GONE);
        liveTranscript.setVisibility(View.GONE);
        expanded = true;
        detail.setVisibility(View.VISIBLE);
        hint.setVisibility(View.VISIBLE);
        shortcuts.setVisibility(View.GONE);
        stop.setVisibility(View.VISIBLE);
    }

    private void toggle() {
        expanded = !expanded;
        int visibility = expanded ? View.VISIBLE : View.GONE;
        if (liveMode) {
            liveStatus.setVisibility(visibility);
            liveTranscript.setVisibility(visibility);
            shortcuts.setVisibility(visibility);
            detail.setVisibility(View.GONE);
            hint.setVisibility(View.GONE);
            stop.setVisibility(View.GONE);
            return;
        }
        detail.setVisibility(visibility);
        hint.setVisibility(visibility);
        shortcuts.setVisibility(visibility);
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
