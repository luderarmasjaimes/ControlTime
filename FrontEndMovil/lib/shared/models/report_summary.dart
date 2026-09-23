/// `GET /api/reports` — listado de informes. Forma exacta de campos no
/// volcada por la investigación de la API; se parsea defensivamente (ver
/// docs/decisions/0001 §Verificación).
class ReportSummary {
  const ReportSummary({required this.id, required this.title, this.updatedAt, this.projectName});

  final String id;
  final String title;
  final DateTime? updatedAt;
  final String? projectName;

  factory ReportSummary.fromJson(Map<String, dynamic> json) => ReportSummary(
        id: (json['id'] ?? '').toString(),
        title: (json['title'] ?? json['name'] ?? 'Informe') as String,
        updatedAt: json['updated_at'] != null ? DateTime.tryParse(json['updated_at'] as String) : null,
        projectName: json['project_name'] as String?,
      );
}
