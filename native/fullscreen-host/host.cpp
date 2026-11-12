// Ghostlink fullscreen host. Copyright 2026 Ghostlink contributors.
// SPDX-License-Identifier: GPL-3.0-or-later
#include "pch.h"
#include "ScalingRuntime.h"
#include "ScalingOptions.h"
#include "Logger.h"
#include "CommonSharedConstants.h"
#include <shellapi.h>
#include <magnification.h>
#include <tlhelp32.h>
#include <charconv>
#include <deque>
#include <mutex>
#include <sstream>
#include <thread>

namespace {
constexpr UINT commandMessage = WM_APP + 1;
constexpr int exitHotkey = 1;
std::mutex commandsMutex;
std::deque<std::string> commands;
std::atomic<int> scalingError{0};
DWORD mainThread;
HWND sourceWindow = nullptr;
DWORD sourcePid = 0, sourceThread = 0;
bool starting = false;
std::atomic<bool> ownsCursorEffects{false};
ULONGLONG startTime = 0;

bool Number(std::string_view text, uint64_t& value) {
    auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), value);
    return error == std::errc{} && end == text.data() + text.size();
}

void Reply(const char* state, int error = 0) {
    const std::string line = fmt::format(
        "{{\"protocol\":1,\"state\":\"{}\",\"error\":{},\"target\":{}}}\n",
        state, error, (uintptr_t)sourceWindow);
    DWORD written = 0;
    WriteFile(GetStdHandle(STD_OUTPUT_HANDLE), line.data(), (DWORD)line.size(), &written, nullptr);
}

bool Valid(HWND hwnd, DWORD pid, DWORD thread) {
    DWORD actualPid = 0;
    const DWORD actualThread = GetWindowThreadProcessId(hwnd, &actualPid);
    RECT rect{};
    return hwnd && actualThread == thread && actualPid == pid &&
        pid != GetCurrentProcessId() && GetAncestor(hwnd, GA_ROOT) == hwnd &&
        hwnd != GetShellWindow() && hwnd != GetDesktopWindow() &&
        IsWindowVisible(hwnd) && GetClientRect(hwnd, &rect) &&
        rect.right >= 16 && rect.bottom >= 16 && rect.right <= 16384 && rect.bottom <= 16384;
}

DWORD ParentPid() {
    wil::unique_handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
    PROCESSENTRY32 entry{sizeof(entry)};
    if (!snapshot || !Process32First(snapshot.get(), &entry)) return 0;
    do {
        if (entry.th32ProcessID == GetCurrentProcessId()) return entry.th32ParentProcessID;
    } while (Process32Next(snapshot.get(), &entry));
    return 0;
}

// Also used after a fault, when the engine's C++ destructors cannot run.
void RestoreCursor() {
    if (!ownsCursorEffects.load()) return;
    ClipCursor(nullptr);
    if (auto show = reinterpret_cast<void(WINAPI*)(BOOL)>(
        GetProcAddress(GetModuleHandleW(L"user32.dll"), "ShowSystemCursor"))) show(TRUE);
    else if (MagInitialize()) { MagShowSystemCursor(TRUE); MagUninitialize(); }
}
LONG WINAPI Unhandled(EXCEPTION_POINTERS*) {
    RestoreCursor();
    return EXCEPTION_EXECUTE_HANDLER;
}

void ReadCommands() {
    const HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    std::string line;
    char ch;
    DWORD read;
    while (ReadFile(input, &ch, 1, &read, nullptr) && read == 1) {
        if (ch == '\n') {
            if (!line.empty() && line.back() == '\r') line.pop_back();
            {
                std::lock_guard lock(commandsMutex);
                if (commands.size() >= 8) break;
                commands.push_back(std::move(line));
            }
            line.clear();
            PostThreadMessageW(mainThread, commandMessage, 0, 0);
        } else if (line.size() < 128) line += ch;
        else break; // Oversized/malformed control stream terminates the session.
    }
    PostThreadMessageW(mainThread, WM_QUIT, 0, 0);
}

Magpie::ScalingOptions Options() {
    Magpie::ScalingOptions options;
    options.effects.push_back({.name = "Bilinear", .scalingType = Magpie::ScalingType::Fit});
    // Avoid persistent system pointer speed changes and direct-flip overlay exclusion.
    options.flags = Magpie::ScalingFlags::DisableDirectFlip;
    options.maxFrameRate = 60.0f;
    options.fullscreenInitialToolbarState = Magpie::ToolbarState::Off;
    options.windowedInitialToolbarState = Magpie::ToolbarState::Off;
    options.overlayOptions.scaleShortcut = "Ctrl+Alt+F11";
    options.overlayOptions.windowedModeScaleShortcut = "Unavailable";
    options.overlayOptions.takeScreenshotShortcut = "Unavailable";
    options.showToast = [](HWND, std::wstring_view, std::wstring_view) noexcept {};
    options.showError = [](HWND, Magpie::ScalingError error) noexcept {
        scalingError.store((int)error);
    };
    options.save = [](const Magpie::ScalingOptions&, HWND) noexcept {};
    return options;
}

const char* State(Magpie::ScalingRuntime& runtime) {
    HWND scaled = FindWindowW(Magpie::CommonSharedConstants::SCALING_WINDOW_CLASS_NAME, nullptr);
    if (scaled && IsWindowVisible(scaled) &&
        GetPropW(scaled, L"Magpie.SrcHWND") == sourceWindow) {
        starting = false;
        return "scaling";
    }
    if (scalingError.load()) { starting = false; return "failed"; }
    if (starting && GetTickCount64() - startTime < 15000) return "starting";
    starting = false;
    if (runtime.State() != Magpie::ScalingState::Idle) return "waiting";
    return "idle";
}
}

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    SetUnhandledExceptionFilter(Unhandled);
    // No named endpoint: only the spawning process owns the inherited control pipes.
    wil::unique_handle parent(OpenProcess(SYNCHRONIZE, FALSE, ParentPid()));
    if (!parent || GetFileType(GetStdHandle(STD_INPUT_HANDLE)) != FILE_TYPE_PIPE ||
        GetFileType(GetStdHandle(STD_OUTPUT_HANDLE)) != FILE_TYPE_PIPE) return 2;
    if (!RegisterHotKey(nullptr, exitHotkey, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_F11)) {
        Reply("failed", -2);
        return 3; // Never enter fullscreen without the exit shortcut.
    }
    mainThread = GetCurrentThreadId();
    MSG msg;
    PeekMessageW(&msg, nullptr, 0, 0, PM_NOREMOVE);
    winrt::init_apartment(winrt::apartment_type::single_threaded);
    wil::unique_handle shutdown(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    if (!shutdown) return 4;
    std::thread guardian([&] {
        HANDLE handles[]{parent.get(), shutdown.get()};
        if (WaitForMultipleObjects(2, handles, FALSE, INFINITE) == WAIT_OBJECT_0) {
            PostThreadMessageW(mainThread, WM_QUIT, 0, 0);
            if (WaitForSingleObject(shutdown.get(), 6000) == WAIT_TIMEOUT) {
                RestoreCursor();
                ExitProcess(4); // Parent is gone and the renderer did not unwind.
            }
        }
    });
    std::thread reader(ReadCommands);
    try {
        // Rust supplies a private writable working directory containing the pinned effects.
        std::filesystem::create_directories(L"logs");
        Magpie::Logger::Get().Initialize(spdlog::level::info, L"logs/fullscreen-host.log", 500000, 2);
        {
            Magpie::ScalingRuntime runtime;
            Reply("ready");
            bool running = true;
            while (running && WaitForSingleObject(parent.get(), 0) == WAIT_TIMEOUT) {
                while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
                    if (msg.message == WM_QUIT ||
                        (msg.message == WM_HOTKEY && msg.wParam == exitHotkey)) {
                        running = false;
                        break;
                    }
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                std::deque<std::string> pending;
                { std::lock_guard lock(commandsMutex); pending.swap(commands); }
                for (const auto& line : pending) {
                    if (!running) break;
                    if (line == "status") Reply(State(runtime), scalingError.load());
                    else if (line == "stop") {
                        runtime.Stop(); starting = false; running = false;
                        Reply("stopping");
                    } else if (line == "quit") {
                        running = false;
                    } else {
                        std::istringstream input(line);
                        std::string verb, hwndText, pidText, threadText, extra;
                        uint64_t hwnd = 0, pid = 0, thread = 0;
                        input >> verb >> hwndText >> pidText >> threadText;
                        if (verb != "start" || (input >> extra) ||
                            !Number(hwndText, hwnd) || !Number(pidText, pid) || !Number(threadText, thread) ||
                            hwnd > UINTPTR_MAX || pid > UINT32_MAX || thread > UINT32_MAX ||
                            !Valid((HWND)(uintptr_t)hwnd, (DWORD)pid, (DWORD)thread) ||
                            pid == ParentPid() || IsIconic((HWND)(uintptr_t)hwnd) ||
                            sourceWindow || FindWindowW(Magpie::CommonSharedConstants::SCALING_WINDOW_CLASS_NAME, nullptr)) {
                            Reply("rejected", -1);
                            continue;
                        }
                        sourceWindow = (HWND)(uintptr_t)hwnd;
                        sourcePid = (DWORD)pid;
                        sourceThread = (DWORD)thread;
                        scalingError.store(0);
                        starting = true;
                        startTime = GetTickCount64();
                        // The foreground Ghostlink parent requests activation only
                        // after this helper is ready. Wait for the target's input
                        // queue to process it; immediate GetForegroundWindow is racy.
                        if (GetForegroundWindow() != sourceWindow) SetForegroundWindow(sourceWindow);
                        const ULONGLONG focusDeadline = GetTickCount64() + 1000;
                        while (GetForegroundWindow() != sourceWindow &&
                            GetTickCount64() < focusDeadline &&
                            WaitForSingleObject(parent.get(), 0) == WAIT_TIMEOUT) {
                            MSG focusMessage;
                            while (PeekMessageW(&focusMessage, nullptr, 0, 0, PM_REMOVE)) {
                                if (focusMessage.message == WM_QUIT ||
                                    (focusMessage.message == WM_HOTKEY && focusMessage.wParam == exitHotkey)) {
                                    running = false;
                                }
                                TranslateMessage(&focusMessage);
                                DispatchMessageW(&focusMessage);
                            }
                            if (!running) break;
                            MsgWaitForMultipleObjects(0, nullptr, FALSE, 10, QS_ALLINPUT);
                        }
                        if (!running || GetForegroundWindow() != sourceWindow) {
                            scalingError.store(-3);
                            Reply("failed", -3);
                            continue;
                        }
                        ownsCursorEffects.store(true);
                        runtime.Start(sourceWindow, Options(), false);
                        Reply("starting");
                    }
                }
                if (sourceWindow) {
                    DWORD actualPid = 0;
                    if (GetWindowThreadProcessId(sourceWindow, &actualPid) != sourceThread || actualPid != sourcePid)
                        running = false;
                }
                HANDLE handle = parent.get();
                if (running) MsgWaitForMultipleObjects(1, &handle, FALSE, 50, QS_ALLINPUT);
            }
            // Runtime destruction pumps messages, joins its render thread and restores the source.
        }
        RestoreCursor();
        Magpie::Logger::Get().Flush();
    } catch (...) {
        RestoreCursor();
    }
    SetEvent(shutdown.get());
    guardian.join();
    UnregisterHotKey(nullptr, exitHotkey);
    while (WaitForSingleObject(reader.native_handle(), 0) == WAIT_TIMEOUT) {
        CancelSynchronousIo(reader.native_handle());
        Sleep(1);
    }
    reader.join();
    return 0;
}
