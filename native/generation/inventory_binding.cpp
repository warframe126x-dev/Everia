#include "internal.hpp"
namespace everia::generation::detail {
#include "payload_inventory.hpp"
const Inventory& trusted_inventory() { return embedded_inventory(); }
}
