// SPDX-License-Identifier: GPL-3.0-or-later
// Real animated Win32 source for the local Magpie integration checks.
#define NOMINMAX
#include <windows.h>
#include <cstdio>
#include <string>
#include <thread>
#include <deque>
#include <mutex>
#include <atomic>
#include <sstream>
HWND fixtureWindow;
DWORD uiThread;
std::mutex queueMutex;
std::deque<std::string> queue;
unsigned tick = 0, clicks = 0;

void Status() {
    RECT src{}; GetClientRect(fixtureWindow, &src);
    MapWindowPoints(fixtureWindow, nullptr, (POINT*)&src, 2);
    HWND scaled = FindWindowW(L"Window_Magpie_967EB565-6F73-4E94-AE53-00CC42592A22", nullptr);
    auto edge = [&](const wchar_t* p) { return (int)(INT_PTR)GetPropW(scaled, p); };
    RECT clip{}; GetClipCursor(&clip);
    CURSORINFO ci{sizeof(ci)}; GetCursorInfo(&ci);
    DWORD helperPid=0; DWORD helperThread=GetWindowThreadProcessId(scaled,&helperPid);
    int speed=0; SystemParametersInfoW(SPI_GETMOUSESPEED,0,&speed,0);
    std::printf("{\"hwnd\":%llu,\"pid\":%lu,\"thread\":%lu,\"clicks\":%u,\"frames\":%u,\"minimized\":%s,\"foreground\":%llu,\"scalingHwnd\":%llu,\"helperPid\":%lu,\"helperThread\":%lu,\"source\":[%d,%d,%d,%d],\"input\":[%d,%d,%d,%d],\"display\":[%d,%d,%d,%d],\"clip\":[%ld,%ld,%ld,%ld],\"cursorFlags\":%lu,\"speed\":%d}\n",
        (unsigned long long)fixtureWindow,GetCurrentProcessId(),uiThread,clicks,tick,IsIconic(fixtureWindow)?"true":"false",
        (unsigned long long)GetForegroundWindow(),(unsigned long long)scaled,helperPid,helperThread,
        src.left,src.top,src.right,src.bottom,
        edge(L"Magpie.SrcLeft"),edge(L"Magpie.SrcTop"),edge(L"Magpie.SrcRight"),edge(L"Magpie.SrcBottom"),
        edge(L"Magpie.DestLeft"),edge(L"Magpie.DestTop"),edge(L"Magpie.DestRight"),edge(L"Magpie.DestBottom"),
        clip.left,clip.top,clip.right,clip.bottom,ci.flags,speed);
    std::fflush(stdout);
}
LRESULT CALLBACK WndProc(HWND hwnd, UINT message, WPARAM w, LPARAM l) {
    switch(message) {
    case WM_TIMER: ++tick; InvalidateRect(hwnd,nullptr,FALSE); return 0;
    case WM_LBUTTONDOWN: ++clicks; InvalidateRect(hwnd,nullptr,FALSE); return 0;
    case WM_PAINT: {
        PAINTSTRUCT ps; HDC dc=BeginPaint(hwnd,&ps); RECT r; GetClientRect(hwnd,&r);
        HBRUSH brush=CreateSolidBrush(RGB(25,40,60)); FillRect(dc,&r,brush); DeleteObject(brush);
        SetTextColor(dc,RGB(255,255,255)); SetBkMode(dc,TRANSPARENT);
        std::wstring text=L"Ghostlink fullscreen trial | Clicks: "+std::to_wstring(clicks)+L" | Frame: "+std::to_wstring(tick);
        TextOutW(dc,20,30,text.c_str(),(int)text.size());
        for (int i=0;i<4;++i) {
            RECT corner{ i&1 ? r.right-45 : 0, i&2 ? r.bottom-45 : 0, i&1 ? r.right : 45, i&2 ? r.bottom : 45 };
            brush=CreateSolidBrush(RGB(i&1?255:80,i&2?255:80,100)); FillRect(dc,&corner,brush); DeleteObject(brush);
        }
        RECT moving{50+(int)(tick%400),150,100+(int)(tick%400),220};
        brush=CreateSolidBrush(RGB(80,180,250)); FillRect(dc,&moving,brush); DeleteObject(brush);
        EndPaint(hwnd,&ps); return 0;
    }
    case WM_DESTROY: PostQuitMessage(0); return 0;
    }
    return DefWindowProcW(hwnd,message,w,l);
}
int main() {
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    uiThread=GetCurrentThreadId();
    WNDCLASSW cls{}; cls.lpfnWndProc=WndProc; cls.hInstance=GetModuleHandleW(nullptr);
    cls.lpszClassName=L"GhostlinkFullscreenFixture"; cls.hCursor=LoadCursorW(nullptr,IDC_ARROW);
    RegisterClassW(&cls);
    fixtureWindow=CreateWindowW(cls.lpszClassName,L"Ghostlink fullscreen trial",WS_OVERLAPPEDWINDOW,
        400,250,656,519,nullptr,nullptr,cls.hInstance,nullptr);
    ShowWindow(fixtureWindow,SW_SHOWNOACTIVATE); SetTimer(fixtureWindow,1,16,nullptr);
    Status();
    std::thread([] {
        std::string line; char c; DWORD n;
        while(ReadFile(GetStdHandle(STD_INPUT_HANDLE),&c,1,&n,nullptr)&&n) {
            if(c=='\n') { {std::lock_guard lock(queueMutex);queue.push_back(line);}line.clear();PostThreadMessageW(uiThread,WM_APP+1,0,0);}
            else if(c!='\r'&&line.size()<128) line+=c;
        }
        PostThreadMessageW(uiThread,WM_QUIT,0,0);
    }).detach();
    MSG msg;
    while(GetMessageW(&msg,nullptr,0,0)>0) {
        { // Drain even if a modal Windows loop consumed the thread wakeup.
            std::deque<std::string> pending; {std::lock_guard lock(queueMutex);pending.swap(queue);}
            for(auto& command:pending) {
                if(command=="minimize") ShowWindow(fixtureWindow,SW_MINIMIZE);
                if(command=="restore") ShowWindow(fixtureWindow,SW_RESTORE);
                if(command=="focus") SetForegroundWindow(fixtureWindow);
                if(command=="resize") SetWindowPos(fixtureWindow,nullptr,450,280,756,569,SWP_NOZORDER|SWP_NOACTIVATE);
                if(command=="close") { DestroyWindow(fixtureWindow); continue; }
                Status();
            }
        }
        TranslateMessage(&msg);DispatchMessageW(&msg);
    }
}
