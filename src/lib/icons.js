import {
  createIcons, Home, Camera, ChartPie, User, Search, SlidersHorizontal, Upload, Sun, Moon, Monitor,
  LogOut, ArrowLeft, ArrowRight, LogIn, UserPlus, TrendingUp, TrendingDown, RefreshCw, X, Radio,
  Sparkles, Image, Activity, Mail, Lock
} from 'lucide';

const icons = {
  Home, Camera, ChartPie, User, Search, SlidersHorizontal, Upload, Sun, Moon, Monitor, LogOut,
  ArrowLeft, ArrowRight, LogIn, UserPlus, TrendingUp, TrendingDown, RefreshCw, X, Radio, Sparkles, Image, Activity, Mail, Lock
};

/** Replaces every pending <i data-lucide> placeholder in the document. */
export function renderIcons() {
  createIcons({ icons, attrs: { 'aria-hidden': 'true', 'stroke-width': '1.8' } });
}
