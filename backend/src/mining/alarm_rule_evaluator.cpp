#include "alarm_rule_evaluator.hpp"

namespace mining_iot {

bool evaluateThresholdCondition(const std::string &op, double observedValue,
                                double threshold) {
  if (op == "gt") return observedValue > threshold;
  if (op == "gte") return observedValue >= threshold;
  if (op == "lt") return observedValue < threshold;
  if (op == "lte") return observedValue <= threshold;
  if (op == "eq") return observedValue == threshold;
  return false;
}

double computeRatePerMinute(double previousValue, double currentValue,
                            double deltaSeconds) {
  if (deltaSeconds <= 0.0) return 0.0;
  return (currentValue - previousValue) * (60.0 / deltaSeconds);
}

bool isWithinDebounceWindow(
    const std::optional<std::chrono::steady_clock::time_point> &lastTriggeredAt,
    int debounceSecs, std::chrono::steady_clock::time_point now) {
  if (debounceSecs <= 0 || !lastTriggeredAt.has_value()) return false;
  return (now - *lastTriggeredAt) < std::chrono::seconds(debounceSecs);
}

} // namespace mining_iot
