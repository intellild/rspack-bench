// Benchmark-only wrapper. Keep the allocator identical to the default Linux build.
use std::{alloc::{GlobalAlloc, Layout}, sync::atomic::{AtomicU64, Ordering::SeqCst}};
static LIVE: AtomicU64 = AtomicU64::new(0);
static PEAK: AtomicU64 = AtomicU64::new(0);
static BYTES: AtomicU64 = AtomicU64::new(0);
static CALLS: AtomicU64 = AtomicU64::new(0);
struct CountingAllocator;
#[global_allocator]
static GLOBAL: CountingAllocator = CountingAllocator;
fn allocated(size: usize) {
  let live = LIVE.fetch_add(size as u64, SeqCst) + size as u64;
  PEAK.fetch_max(live, SeqCst);
  BYTES.fetch_add(size as u64, SeqCst);
  CALLS.fetch_add(1, SeqCst);
}
unsafe impl GlobalAlloc for CountingAllocator {
  unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
    let ptr = unsafe { mimalloc::MiMalloc.alloc(layout) };
    if !ptr.is_null() { allocated(layout.size()); }
    ptr
  }
  unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
    let ptr = unsafe { mimalloc::MiMalloc.alloc_zeroed(layout) };
    if !ptr.is_null() { allocated(layout.size()); }
    ptr
  }
  unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
    LIVE.fetch_sub(layout.size() as u64, SeqCst);
    unsafe { mimalloc::MiMalloc.dealloc(ptr, layout); }
  }
  unsafe fn realloc(&self, ptr: *mut u8, old: Layout, size: usize) -> *mut u8 {
    let result = unsafe { mimalloc::MiMalloc.realloc(ptr, old, size) };
    if !result.is_null() {
      if size >= old.size() {
        let live = LIVE.fetch_add((size - old.size()) as u64, SeqCst) + (size - old.size()) as u64;
        PEAK.fetch_max(live, SeqCst);
      } else { LIVE.fetch_sub((old.size() - size) as u64, SeqCst); }
      // Allocation volume counts the whole requested new block, including realloc.
      BYTES.fetch_add(size as u64, SeqCst);
      CALLS.fetch_add(1, SeqCst);
    }
    result
  }
}
// Snapshot before N-API creates the JS result. Totals are never reset.
pub fn benchmark_memory(reset_peak: bool) -> [f64; 4] {
  let live = LIVE.load(SeqCst);
  if reset_peak { PEAK.store(live, SeqCst); }
  [live as f64, PEAK.load(SeqCst) as f64, BYTES.load(SeqCst) as f64, CALLS.load(SeqCst) as f64]
}
