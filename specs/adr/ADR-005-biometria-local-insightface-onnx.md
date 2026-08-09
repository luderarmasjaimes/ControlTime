# ADR-005 — Biometría local InsightFace + ONNX

> [!WARNING]
> **SUPERSEDED:** Esta decisión ha sido reemplazada por **[ADR-089](../../docs/decisions/089-biometria-dermalog-cli-integration.md)**.
> Actualmente el proveedor primario es Dermalog SDK, e InsightFace ha pasado a ser el motor secundario de respaldo (Fallback).

| Campo | Valor |
|---|---|
| **Estado** | **Aceptado** |
| **Fecha** | 2026-06-24 |
| **Decisor(es)** | Arquitecto TI + Especialista IA |
| **Features** | `008`, `017` |

## Contexto
Login biométrico en operaciones mineras requiere procesamiento en VPS soberano (Lima), sin enviar rostros a nube externa por defecto.

## Decisión
Servicio `ai_engine` (Python) con **InsightFace** (embeddings), **ONNX** (clasificadores EPP/gafas), **OpenCV/MediaPipe** en el mismo contenedor. Gateway C++ delega vía HTTP interno.

## Consecuencias
- Modelos en `ai_engine/models/`; entrenamiento separado del serving (BE2 integra, IA entrena — cronograma v36)
- SPEC-017 (EPP) reutiliza la misma pila
