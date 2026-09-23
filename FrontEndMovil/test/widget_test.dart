import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:frontend_movil/core/theme/app_theme.dart';

void main() {
  test('buildAppTheme produce un tema oscuro único (ADR-0006)', () {
    final theme = buildAppTheme();
    expect(theme.brightness, Brightness.dark);
    expect(theme.colorScheme.primary, isNotNull);
  });
}
