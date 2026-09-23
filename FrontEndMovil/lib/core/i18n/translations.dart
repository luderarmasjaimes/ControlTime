import 'dictionaries/en.dart';
import 'dictionaries/es.dart';
import 'dictionaries/fr.dart';
import 'dictionaries/pt.dart';

enum AppLanguage { es, en, fr, pt }

extension AppLanguageCode on AppLanguage {
  String get code => switch (this) {
        AppLanguage.es => 'es',
        AppLanguage.en => 'en',
        AppLanguage.fr => 'fr',
        AppLanguage.pt => 'pt',
      };

  static AppLanguage fromCode(String code) => switch (code) {
        'en' => AppLanguage.en,
        'fr' => AppLanguage.fr,
        'pt' => AppLanguage.pt,
        _ => AppLanguage.es,
      };
}

/// Mismo criterio de fallback que `I18nProvider.tsx` del frontend web
/// (docs/decisions/0006): idioma activo → español (dictionaries[es]) →
/// la clave cruda, nunca una pantalla vacía por una traducción faltante.
class Translations {
  const Translations(this.language);

  final AppLanguage language;

  static const Map<AppLanguage, Map<String, String>> _dictionaries = {
    AppLanguage.es: esDictionary,
    AppLanguage.en: enDictionary,
    AppLanguage.fr: frDictionary,
    AppLanguage.pt: ptDictionary,
  };

  String call(String key, [Map<String, String>? params]) {
    final value = _dictionaries[language]?[key] ?? esDictionary[key] ?? key;
    if (params == null || params.isEmpty) return value;
    var result = value;
    for (final entry in params.entries) {
      result = result.replaceAll('{${entry.key}}', entry.value);
    }
    return result;
  }
}
