import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'translations.dart';

const _prefsKeyLanguage = 'mining_platform_prefs_v1.languageCode';

/// Idioma activo, persistido igual que `platformPrefs.ts` del frontend web
/// (localStorage['mining_platform_prefs_v1']) — aquí en SharedPreferences.
class LanguageNotifier extends Notifier<AppLanguage> {
  @override
  AppLanguage build() {
    _restore();
    return AppLanguage.es;
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    final code = prefs.getString(_prefsKeyLanguage);
    if (code != null) {
      state = AppLanguageCode.fromCode(code);
    }
  }

  Future<void> setLanguage(AppLanguage language) async {
    state = language;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKeyLanguage, language.code);
  }
}

final languageProvider = NotifierProvider<LanguageNotifier, AppLanguage>(LanguageNotifier.new);

final translationsProvider = Provider<Translations>((ref) {
  final language = ref.watch(languageProvider);
  return Translations(language);
});
